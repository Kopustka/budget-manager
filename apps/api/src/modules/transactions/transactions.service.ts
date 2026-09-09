import type { ChainableCommander } from 'ioredis';
import {
  resolveMatrix,
  type DndEventInput,
  type DndResult,
  type EditTransactionInput,
  type Transaction,
  type Wallet,
} from '@budget/shared';
import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool, withTransaction, type PoolClient } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { cache } from '../../redis/cache.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import { periodOf } from '../../shared/period.js';
import { alertsService } from '../alerts/alerts.service.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { transactionsRepository } from './transactions.repository.js';

/**
 * Транзакционное ядро Drag-and-Drop.
 *
 * Инвариант атомарности: PostgreSQL — source of truth, Redis — производный
 * быстрый слой. Все изменения БД идут одной PG-транзакцией; Redis-команды
 * копятся и выполняются одним pipeline СРАЗУ ПОСЛЕ коммита. Если PG откатился —
 * pipeline не выполняется вовсе; если упал Redis — кэш пересобирается из PG
 * (`resyncCache`), поэтому расхождение самоисправляется, а не залипает.
 */

/** Итог операции для клиента + данные для алертов бота. */
export interface DndOutcome extends DndResult {
  transaction: Transaction;
}

type CacheOps = (pipe: ChainableCommander) => void;

/** Выполнить накопленные Redis-команды одним pipeline; при сбое — пересинхронизировать. */
async function flushCache(ops: CacheOps, resync: () => Promise<void>): Promise<void> {
  const pipe = redis.pipeline();
  ops(pipe);
  try {
    const results = await pipe.exec();
    const failed = results?.find(([err]) => err);
    if (failed) throw failed[0];
  } catch {
    await resync().catch(() => undefined);
  }
}

/**
 * Заблокировать два кошелька в одной транзакции.
 *
 * Порядок блокировки — по возрастанию id, а не по смыслу «сначала источник».
 * Два встречных перевода (A→B и B→A) в один момент брали бы строки в обратном
 * порядке и вставали бы в дедлок; общий порядок исключает это по построению.
 */
async function lockWalletPair(
  db: PoolClient,
  profileId: string,
  fromId: string,
  toId: string,
): Promise<{ from: Wallet; to: Wallet }> {
  const [firstId, secondId] = fromId < toId ? [fromId, toId] : [toId, fromId];
  const first = await walletsRepository.findOwned(db, profileId, firstId, true);
  const second = await walletsRepository.findOwned(db, profileId, secondId, true);
  return firstId === fromId ? { from: first, to: second } : { from: second, to: first };
}

/** Пересобрать кэш балансов пары кошельков из PostgreSQL. */
async function resyncWallets(profileId: string, ...walletIds: string[]): Promise<void> {
  const pipe = redis.pipeline();
  for (const id of walletIds) {
    const wallet = await walletsRepository.findOwned(pool, profileId, id);
    cache.setWalletBalance(profileId, id, wallet.balance, pipe);
  }
  await pipe.exec();
}

/** Пересобрать кэш кошелька и spent категории из PostgreSQL. */
async function resyncFromDb(
  profileId: string,
  walletId: string,
  categoryId: string,
  period: string,
  monthStartDay: number,
): Promise<void> {
  const wallet = await walletsRepository.findOwned(pool, profileId, walletId);
  const spent = await transactionsRepository.sumSpent(
    pool,
    profileId,
    categoryId,
    period,
    monthStartDay,
  );
  const pipe = redis.pipeline();
  cache.setWalletBalance(profileId, walletId, wallet.balance, pipe);
  cache.setSpent(profileId, period, categoryId, spent, pipe);
  await pipe.exec();
}

async function limitFor(
  db: PoolClient,
  profileId: string,
  categoryId: string,
  period: string,
): Promise<number | null> {
  // Быстрый путь — Redis; при промахе идём в PG и прогреваем кэш.
  const cached = await cache.getLimit(profileId, period, categoryId).catch(() => null);
  if (cached !== null) return cached;
  const limit = await categoriesRepository.findLimit(db, categoryId, period);
  if (limit !== null) cache.setLimit(profileId, period, categoryId, limit);
  return limit;
}

export const transactionsService = {
  /**
   * Обработка события матрицы: `Доход→Кошелёк` (зачисление) или
   * `Кошелёк→Расход` (списание с проверкой средств и лимита).
   */
  async processDnd(profile: ProfileScope, input: DndEventInput): Promise<DndOutcome> {
    const matrix = resolveMatrix(input.source, input.target);
    if (!matrix.allowed || !matrix.action) {
      throw new ForbiddenError(matrix.reason ?? 'Операция запрещена матрицей');
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      throw new ValidationError('Некорректная дата операции');
    }
    const period = periodOf(occurredAt, profile.monthStartDay);
    const action = matrix.action;

    if (action === 'transfer') {
      return this.processTransfer(profile, input, occurredAt);
    }

    // Схема запроса уже потребовала категорию для зачисления и списания;
    // проверка здесь — страховка на случай вызова в обход валидации.
    if (!input.categoryId) throw new ValidationError('Не указана категория');
    const categoryId = input.categoryId;

    const { outcome, ops, categoryName } = await withTransaction(async (client) => {
      const wallet = await walletsRepository.findOwned(client, profile.id, input.walletId, true);
      const category = await categoriesRepository.findOwned(client, profile.id, categoryId);

      const expectedKind = action === 'deposit' ? 'income' : 'expense';
      if (category.kind !== expectedKind) {
        throw new ValidationError(
          `Для операции «${action}» нужна категория типа ${expectedKind}, а получена ${category.kind}`,
        );
      }

      const delta = action === 'deposit' ? input.amount : -input.amount;
      if (action === 'spend' && wallet.balance + delta < 0) {
        throw new ConflictError('Недостаточно средств в кошельке');
      }

      const balance = await walletsRepository.applyDelta(client, wallet.id, delta);
      const tx = await transactionsRepository.insert(client, {
        profileId: profile.id,
        type: action,
        walletId: wallet.id,
        categoryId: category.id,
        amount: input.amount,
        subcategory: input.subcategory ?? null,
        comment: input.comment ?? null,
        occurredAt,
      });

      // spent считаем из PG (уже с учётом вставленной строки) — кэш не дрейфует.
      const spent =
        action === 'spend'
          ? await transactionsRepository.sumSpent(
              client,
              profile.id,
              category.id,
              period,
              profile.monthStartDay,
            )
          : 0;
      const limit = action === 'spend' ? await limitFor(client, profile.id, category.id, period) : null;

      const occurredUnix = Math.floor(occurredAt.getTime() / 1000);
      const nowUnix = Math.floor(Date.now() / 1000);

      return {
        // Имя категории нужно тексту уведомления — вытаскиваем из транзакции,
        // чтобы потом не ходить в БД второй раз.
        categoryName: category.name,
        outcome: {
          transactionId: tx.id,
          transaction: tx,
          walletBalance: balance,
          toWalletBalance: null,
          categorySpent: spent,
          categoryLimit: limit,
          isOverdraft: limit !== null && spent > limit,
        } satisfies DndOutcome,
        // spent здесь не пишем: для списания его записывает атомарный скрипт
        // проверки лимита ниже — иначе два писателя одного поля разъезжаются.
        ops: ((pipe) => {
          cache.setWalletBalance(profile.id, wallet.id, balance, pipe);
          cache.addTxToCache(profile.id, tx.id, occurredUnix, pipe);
          cache.trimTxCache(profile.id, nowUnix, pipe);
        }) satisfies CacheOps,
      };
    });

    await flushCache(ops, () =>
      resyncFromDb(profile.id, input.walletId, categoryId, period, profile.monthStartDay),
    );

    if (action === 'spend') {
      // Фиксация spent и проверка лимита идут одним EVAL. Ронять проведённую
      // операцию из-за Redis нельзя, но и оставлять кэш расходиться с базой —
      // тоже: при сбое пересобираем spent из PostgreSQL.
      await alertsService
        .settleSpend({
          profile,
          categoryId,
          categoryName,
          spent: outcome.categorySpent,
          limit: outcome.categoryLimit,
          period,
        })
        .catch(() =>
          resyncFromDb(
            profile.id,
            input.walletId,
            categoryId,
            period,
            profile.monthStartDay,
          ).catch(() => undefined),
        );

      // Темп трат считается по PostgreSQL и к кэшу отношения не имеет —
      // это чистый побочный эффект, его сбой гасим молча.
      await alertsService.checkDailyPace(profile, occurredAt, period).catch(() => undefined);
    }

    return outcome;
  },

  /**
   * Перевод между своими кошельками: деньги уходят из одного и приходят в другой
   * одной строкой истории.
   *
   * Ни лимитов, ни уведомлений здесь нет намеренно: перевод не трата. Сумма
   * бюджета не изменилась, категории у операции нет, и дёргать проверку плана
   * (а тем более слать пуш «план превышен») было бы ложной тревогой.
   */
  async processTransfer(
    profile: ProfileScope,
    input: DndEventInput,
    occurredAt: Date,
  ): Promise<DndOutcome> {
    // Схема уже проверила оба условия; дублируем на случай вызова в обход zod.
    if (!input.toWalletId) throw new ValidationError('Не указан кошелёк-получатель');
    const toWalletId = input.toWalletId;
    if (toWalletId === input.walletId) {
      throw new ValidationError('Перевод в тот же кошелёк невозможен');
    }

    const { outcome, ops } = await withTransaction(async (client) => {
      const { from, to } = await lockWalletPair(client, profile.id, input.walletId, toWalletId);

      if (from.balance - input.amount < 0) {
        throw new ConflictError('Недостаточно средств в кошельке');
      }

      const fromBalance = await walletsRepository.applyDelta(client, from.id, -input.amount);
      const toBalance = await walletsRepository.applyDelta(client, to.id, input.amount);

      const tx = await transactionsRepository.insert(client, {
        profileId: profile.id,
        type: 'transfer',
        walletId: from.id,
        toWalletId: to.id,
        categoryId: null,
        amount: input.amount,
        // Подкатегория — атрибут траты; у перевода осмысленного значения нет.
        subcategory: null,
        comment: input.comment ?? null,
        occurredAt,
      });

      const occurredUnix = Math.floor(occurredAt.getTime() / 1000);
      const nowUnix = Math.floor(Date.now() / 1000);

      return {
        outcome: {
          transactionId: tx.id,
          transaction: tx,
          walletBalance: fromBalance,
          toWalletBalance: toBalance,
          categorySpent: 0,
          categoryLimit: null,
          isOverdraft: false,
        } satisfies DndOutcome,
        ops: ((pipe) => {
          cache.setWalletBalance(profile.id, from.id, fromBalance, pipe);
          cache.setWalletBalance(profile.id, to.id, toBalance, pipe);
          cache.addTxToCache(profile.id, tx.id, occurredUnix, pipe);
          cache.trimTxCache(profile.id, nowUnix, pipe);
        }) satisfies CacheOps,
      };
    });

    await flushCache(ops, () => resyncWallets(profile.id, input.walletId, toWalletId));
    return outcome;
  },

  /**
   * Правка транзакции: сумма, подкатегория, комментарий, перепривязка категории.
   * Балансы и spent корректируются дельтами внутри той же PG-транзакции.
   */
  async edit(profile: ProfileScope, txId: string, input: EditTransactionInput): Promise<DndOutcome> {
    // Тип операции неизменен, поэтому ветку выбираем до транзакции — гонки тут нет.
    const existing = await transactionsRepository.findOwned(pool, profile.id, txId);
    if (existing.type === 'transfer') return this.editTransfer(profile, existing, input);

    const { outcome, ops, period, walletId, categoryIds } = await withTransaction(
      async (client) => {
        const old = await transactionsRepository.findOwned(client, profile.id, txId, true);
        if (!old.walletId) throw new ValidationError('Транзакция без кошелька не редактируется');

        const wallet = await walletsRepository.findOwned(client, profile.id, old.walletId, true);
        const newAmount = input.amount ?? old.amount;
        const newCategoryId = input.categoryId ?? old.categoryId;
        if (!newCategoryId) throw new ValidationError('Не указана категория');

        const category = await categoriesRepository.findOwned(client, profile.id, newCategoryId);
        const expectedKind = old.type === 'deposit' ? 'income' : 'expense';
        if (category.kind !== expectedKind) {
          throw new ValidationError(
            `Нельзя перепривязать ${old.type} к категории типа ${category.kind}`,
          );
        }

        // Разница в деньгах: для deposit баланс растёт вместе с суммой, для spend — падает.
        const sign = old.type === 'deposit' ? 1 : -1;
        const delta = sign * (newAmount - old.amount);
        if (wallet.balance + delta < 0) {
          throw new ConflictError('Правка уводит баланс кошелька в минус');
        }

        const balance = await walletsRepository.applyDelta(client, wallet.id, delta);
        const tx = await transactionsRepository.update(client, old.id, {
          amount: newAmount,
          categoryId: newCategoryId,
          subcategory: input.subcategory === undefined ? old.subcategory : input.subcategory ?? null,
          comment: input.comment === undefined ? old.comment : input.comment ?? null,
        });

        const p = periodOf(new Date(old.occurredAt), profile.monthStartDay);
        // Категория могла смениться — пересчитываем обе.
        const touched = new Set<string>([newCategoryId]);
        if (old.categoryId) touched.add(old.categoryId);

        const spentByCategory = new Map<string, number>();
        if (old.type === 'spend') {
          for (const id of touched) {
            spentByCategory.set(
              id,
              await transactionsRepository.sumSpent(client, profile.id, id, p, profile.monthStartDay),
            );
          }
        }
        const spent = spentByCategory.get(newCategoryId) ?? 0;
        const limit =
          old.type === 'spend' ? await limitFor(client, profile.id, newCategoryId, p) : null;

        return {
          period: p,
          walletId: wallet.id,
          categoryIds: [...touched],
          outcome: {
            transactionId: tx.id,
            transaction: tx,
            walletBalance: balance,
            toWalletBalance: null,
            categorySpent: spent,
            categoryLimit: limit,
            isOverdraft: limit !== null && spent > limit,
          } satisfies DndOutcome,
          ops: ((pipe) => {
            cache.setWalletBalance(profile.id, wallet.id, balance, pipe);
            for (const [id, value] of spentByCategory) cache.setSpent(profile.id, p, id, value, pipe);
          }) satisfies CacheOps,
        };
      },
    );

    await flushCache(ops, async () => {
      for (const id of categoryIds) {
        await resyncFromDb(profile.id, walletId, id, period, profile.monthStartDay);
      }
    });
    return outcome;
  },

  /**
   * Правка перевода: сумма и комментарий. Категорию и подкатегорию менять нечему,
   * поэтому из EditTransactionInput здесь используется не всё.
   */
  async editTransfer(
    profile: ProfileScope,
    old: Transaction,
    input: EditTransactionInput,
  ): Promise<DndOutcome> {
    // Осиротевший перевод (кошелёк удалён) чинить нечем: денег удалённого
    // кошелька уже нет, и правка одной половины разъехалась бы с фактом.
    if (!old.walletId || !old.toWalletId) {
      throw new ValidationError('Перевод с удалённым кошельком не редактируется');
    }
    const fromId = old.walletId;
    const toId = old.toWalletId;

    const { outcome, ops } = await withTransaction(async (client) => {
      const { from, to } = await lockWalletPair(client, profile.id, fromId, toId);
      const newAmount = input.amount ?? old.amount;
      const diff = newAmount - old.amount;

      if (from.balance - diff < 0) {
        throw new ConflictError('Правка уводит баланс кошелька в минус');
      }
      if (to.balance + diff < 0) {
        throw new ConflictError('Правка уводит баланс кошелька-получателя в минус');
      }

      const fromBalance = await walletsRepository.applyDelta(client, from.id, -diff);
      const toBalance = await walletsRepository.applyDelta(client, to.id, diff);
      const tx = await transactionsRepository.update(client, old.id, {
        amount: newAmount,
        categoryId: null,
        subcategory: null,
        comment: input.comment === undefined ? old.comment : input.comment ?? null,
      });

      return {
        outcome: {
          transactionId: tx.id,
          transaction: tx,
          walletBalance: fromBalance,
          toWalletBalance: toBalance,
          categorySpent: 0,
          categoryLimit: null,
          isOverdraft: false,
        } satisfies DndOutcome,
        ops: ((pipe) => {
          cache.setWalletBalance(profile.id, from.id, fromBalance, pipe);
          cache.setWalletBalance(profile.id, to.id, toBalance, pipe);
        }) satisfies CacheOps,
      };
    });

    await flushCache(ops, () => resyncWallets(profile.id, fromId, toId));
    return outcome;
  },

  /** Удаление транзакции с возвратом денег в кошелёк и пересчётом spent. */
  async remove(
    profile: ProfileScope,
    txId: string,
  ): Promise<{ walletBalance: number; toWalletBalance: number | null }> {
    const existing = await transactionsRepository.findOwned(pool, profile.id, txId);
    if (existing.type === 'transfer') return this.removeTransfer(profile, existing);

    const { balance, ops, period, walletId, categoryId } = await withTransaction(
      async (client) => {
        const old = await transactionsRepository.findOwned(client, profile.id, txId, true);
        if (!old.walletId) throw new ValidationError('Транзакция без кошелька не удаляется');
        const wallet = await walletsRepository.findOwned(client, profile.id, old.walletId, true);

        // Откатываем эффект: deposit возвращаем со счёта, spend — на счёт.
        const delta = old.type === 'deposit' ? -old.amount : old.amount;
        if (wallet.balance + delta < 0) {
          throw new ConflictError('Удаление уводит баланс кошелька в минус');
        }

        const newBalance = await walletsRepository.applyDelta(client, wallet.id, delta);
        await transactionsRepository.remove(client, old.id);

        const p = periodOf(new Date(old.occurredAt), profile.monthStartDay);
        const spent =
          old.type === 'spend' && old.categoryId
            ? await transactionsRepository.sumSpent(
                client,
                profile.id,
                old.categoryId,
                p,
                profile.monthStartDay,
              )
            : null;

        return {
          balance: newBalance,
          period: p,
          walletId: wallet.id,
          categoryId: old.categoryId,
          ops: ((pipe) => {
            cache.setWalletBalance(profile.id, wallet.id, newBalance, pipe);
            if (spent !== null && old.categoryId) {
              cache.setSpent(profile.id, p, old.categoryId, spent, pipe);
            }
            cache.removeTxFromCache(profile.id, old.id, pipe);
          }) satisfies CacheOps,
        };
      },
    );

    await flushCache(ops, async () => {
      if (categoryId) await resyncFromDb(profile.id, walletId, categoryId, period, profile.monthStartDay);
    });
    return { walletBalance: balance, toWalletBalance: null };
  },

  /** Отмена перевода: деньги возвращаются в кошелёк-источник целиком. */
  async removeTransfer(
    profile: ProfileScope,
    old: Transaction,
  ): Promise<{ walletBalance: number; toWalletBalance: number | null }> {
    if (!old.walletId || !old.toWalletId) {
      throw new ValidationError('Перевод с удалённым кошельком не удаляется');
    }
    const fromId = old.walletId;
    const toId = old.toWalletId;

    const { balance, toBalance, ops } = await withTransaction(async (client) => {
      const { from, to } = await lockWalletPair(client, profile.id, fromId, toId);

      // Деньги, уже потраченные с кошелька-получателя, вернуть неоткуда:
      // отмена увела бы его в минус, поэтому останавливаемся честной ошибкой.
      if (to.balance - old.amount < 0) {
        throw new ConflictError('Удаление уводит баланс кошелька-получателя в минус');
      }

      const newFrom = await walletsRepository.applyDelta(client, from.id, old.amount);
      const newTo = await walletsRepository.applyDelta(client, to.id, -old.amount);
      await transactionsRepository.remove(client, old.id);

      return {
        balance: newFrom,
        toBalance: newTo,
        ops: ((pipe) => {
          cache.setWalletBalance(profile.id, from.id, newFrom, pipe);
          cache.setWalletBalance(profile.id, to.id, newTo, pipe);
          cache.removeTxFromCache(profile.id, old.id, pipe);
        }) satisfies CacheOps,
      };
    });

    await flushCache(ops, () => resyncWallets(profile.id, fromId, toId));
    return { walletBalance: balance, toWalletBalance: toBalance };
  },
};
