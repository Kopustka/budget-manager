import type { ChainableCommander } from 'ioredis';
import {
  resolveMatrix,
  type DndEventInput,
  type DndResult,
  type EditTransactionInput,
  type Transaction,
  type User,
} from '@budget/shared';
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

/** Пересобрать кэш кошелька и spent категории из PostgreSQL. */
async function resyncFromDb(
  userId: string,
  walletId: string,
  categoryId: string,
  period: string,
  monthStartDay: number,
): Promise<void> {
  const wallet = await walletsRepository.findOwned(pool, userId, walletId);
  const spent = await transactionsRepository.sumSpent(
    pool,
    userId,
    categoryId,
    period,
    monthStartDay,
  );
  const pipe = redis.pipeline();
  cache.setWalletBalance(userId, walletId, wallet.balance, pipe);
  cache.setSpent(userId, period, categoryId, spent, pipe);
  await pipe.exec();
}

async function limitFor(
  db: PoolClient,
  userId: string,
  categoryId: string,
  period: string,
): Promise<number | null> {
  // Быстрый путь — Redis; при промахе идём в PG и прогреваем кэш.
  const cached = await cache.getLimit(userId, period, categoryId).catch(() => null);
  if (cached !== null) return cached;
  const limit = await categoriesRepository.findLimit(db, categoryId, period);
  if (limit !== null) cache.setLimit(userId, period, categoryId, limit);
  return limit;
}

export const transactionsService = {
  /**
   * Обработка события матрицы: `Доход→Кошелёк` (зачисление) или
   * `Кошелёк→Расход` (списание с проверкой средств и лимита).
   */
  async processDnd(user: User, input: DndEventInput): Promise<DndOutcome> {
    const matrix = resolveMatrix(input.source, input.target);
    if (!matrix.allowed || !matrix.action) {
      throw new ForbiddenError(matrix.reason ?? 'Операция запрещена матрицей');
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      throw new ValidationError('Некорректная дата операции');
    }
    const period = periodOf(occurredAt, user.monthStartDay);
    const action = matrix.action;

    const { outcome, ops, categoryName } = await withTransaction(async (client) => {
      const wallet = await walletsRepository.findOwned(client, user.id, input.walletId, true);
      const category = await categoriesRepository.findOwned(client, user.id, input.categoryId);

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
        userId: user.id,
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
              user.id,
              category.id,
              period,
              user.monthStartDay,
            )
          : 0;
      const limit = action === 'spend' ? await limitFor(client, user.id, category.id, period) : null;

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
          categorySpent: spent,
          categoryLimit: limit,
          isOverdraft: limit !== null && spent > limit,
        } satisfies DndOutcome,
        ops: ((pipe) => {
          cache.setWalletBalance(user.id, wallet.id, balance, pipe);
          if (action === 'spend') cache.setSpent(user.id, period, category.id, spent, pipe);
          cache.addTxToCache(user.id, tx.id, occurredUnix, pipe);
          cache.trimTxCache(user.id, nowUnix, pipe);
        }) satisfies CacheOps,
      };
    });

    await flushCache(ops, () =>
      resyncFromDb(user.id, input.walletId, input.categoryId, period, user.monthStartDay),
    );

    // Уведомления — побочный эффект: их сбой не должен ронять уже проведённую операцию.
    if (action === 'spend') {
      await alertsService
        .evaluateAfterSpend({
          user,
          categoryId: input.categoryId,
          categoryName,
          spent: outcome.categorySpent,
          limit: outcome.categoryLimit,
          period,
          occurredAt,
        })
        .catch(() => undefined);
    }

    return outcome;
  },

  /**
   * Правка транзакции: сумма, подкатегория, комментарий, перепривязка категории.
   * Балансы и spent корректируются дельтами внутри той же PG-транзакции.
   */
  async edit(user: User, txId: string, input: EditTransactionInput): Promise<DndOutcome> {
    const { outcome, ops, period, walletId, categoryIds } = await withTransaction(
      async (client) => {
        const old = await transactionsRepository.findOwned(client, user.id, txId, true);
        if (!old.walletId) throw new ValidationError('Транзакция без кошелька не редактируется');

        const wallet = await walletsRepository.findOwned(client, user.id, old.walletId, true);
        const newAmount = input.amount ?? old.amount;
        const newCategoryId = input.categoryId ?? old.categoryId;
        if (!newCategoryId) throw new ValidationError('Не указана категория');

        const category = await categoriesRepository.findOwned(client, user.id, newCategoryId);
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

        const p = periodOf(new Date(old.occurredAt), user.monthStartDay);
        // Категория могла смениться — пересчитываем обе.
        const touched = new Set<string>([newCategoryId]);
        if (old.categoryId) touched.add(old.categoryId);

        const spentByCategory = new Map<string, number>();
        if (old.type === 'spend') {
          for (const id of touched) {
            spentByCategory.set(
              id,
              await transactionsRepository.sumSpent(client, user.id, id, p, user.monthStartDay),
            );
          }
        }
        const spent = spentByCategory.get(newCategoryId) ?? 0;
        const limit =
          old.type === 'spend' ? await limitFor(client, user.id, newCategoryId, p) : null;

        return {
          period: p,
          walletId: wallet.id,
          categoryIds: [...touched],
          outcome: {
            transactionId: tx.id,
            transaction: tx,
            walletBalance: balance,
            categorySpent: spent,
            categoryLimit: limit,
            isOverdraft: limit !== null && spent > limit,
          } satisfies DndOutcome,
          ops: ((pipe) => {
            cache.setWalletBalance(user.id, wallet.id, balance, pipe);
            for (const [id, value] of spentByCategory) cache.setSpent(user.id, p, id, value, pipe);
          }) satisfies CacheOps,
        };
      },
    );

    await flushCache(ops, async () => {
      for (const id of categoryIds) {
        await resyncFromDb(user.id, walletId, id, period, user.monthStartDay);
      }
    });
    return outcome;
  },

  /** Удаление транзакции с возвратом денег в кошелёк и пересчётом spent. */
  async remove(user: User, txId: string): Promise<{ walletBalance: number }> {
    const { balance, ops, period, walletId, categoryId } = await withTransaction(
      async (client) => {
        const old = await transactionsRepository.findOwned(client, user.id, txId, true);
        if (!old.walletId) throw new ValidationError('Транзакция без кошелька не удаляется');
        const wallet = await walletsRepository.findOwned(client, user.id, old.walletId, true);

        // Откатываем эффект: deposit возвращаем со счёта, spend — на счёт.
        const delta = old.type === 'deposit' ? -old.amount : old.amount;
        if (wallet.balance + delta < 0) {
          throw new ConflictError('Удаление уводит баланс кошелька в минус');
        }

        const newBalance = await walletsRepository.applyDelta(client, wallet.id, delta);
        await transactionsRepository.remove(client, old.id);

        const p = periodOf(new Date(old.occurredAt), user.monthStartDay);
        const spent =
          old.type === 'spend' && old.categoryId
            ? await transactionsRepository.sumSpent(
                client,
                user.id,
                old.categoryId,
                p,
                user.monthStartDay,
              )
            : null;

        return {
          balance: newBalance,
          period: p,
          walletId: wallet.id,
          categoryId: old.categoryId,
          ops: ((pipe) => {
            cache.setWalletBalance(user.id, wallet.id, newBalance, pipe);
            if (spent !== null && old.categoryId) {
              cache.setSpent(user.id, p, old.categoryId, spent, pipe);
            }
            cache.removeTxFromCache(user.id, old.id, pipe);
          }) satisfies CacheOps,
        };
      },
    );

    await flushCache(ops, async () => {
      if (categoryId) await resyncFromDb(user.id, walletId, categoryId, period, user.monthStartDay);
    });
    return { walletBalance: balance };
  },
};
