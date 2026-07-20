import {
  PLANNED_WINDOW_DAYS,
  type PlannedOccurrence,
  type PlannedSummary,
  type PlannedTransaction,
} from '@budget/shared';
import { pool, withTransaction } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { rkey } from '../../redis/keys.js';
import { cache } from '../../redis/cache.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { periodOf, periodRange } from '../../shared/period.js';
import type { ProfileScope } from '../profiles/profiles.repository.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { transactionsRepository } from '../transactions/transactions.repository.js';
import { plannedRepository } from './planned.repository.js';

/** YYYY-MM-DD в UTC. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Полночь UTC указанного дня. */
function midnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Даты, в которые правило срабатывает внутри отрезка [from, to].
 *
 * Ежемесячное правило разворачивается на лету, а не хранится строками: иначе
 * подписка на год вперёд занимала бы двенадцать записей, которых никто не
 * спрашивал, и правка суммы задним числом ломала бы уже созданные.
 */
export function occurrencesOf(rule: PlannedTransaction, from: Date, to: Date): string[] {
  const dates: string[] = [];

  if (rule.recurrence === 'once') {
    if (rule.dueDate && rule.dueDate >= dayKey(from) && rule.dueDate <= dayKey(to)) {
      dates.push(rule.dueDate);
    }
    return dates;
  }

  const day = rule.dueDay ?? 1;
  // Идём по месяцам отрезка: он короткий (30 дней), поэтому их не больше двух.
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const limit = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= limit) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), day));
    const key = dayKey(date);
    if (key >= dayKey(from) && key <= dayKey(to)) dates.push(key);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

export const plannedService = {
  /** Экземпляры событий на окно календаря со статусами. */
  async occurrences(
    profile: ProfileScope,
    from: Date = midnight(new Date()),
    days: number = PLANNED_WINDOW_DAYS,
  ): Promise<PlannedOccurrence[]> {
    const to = new Date(from.getTime() + (days - 1) * 86_400_000);
    const [rules, settlements] = await Promise.all([
      plannedRepository.listByProfile(profile.id),
      plannedRepository.settlementsInRange(profile.id, dayKey(from), dayKey(to)),
    ]);

    const settled = new Map(settlements.map((s) => [`${s.plannedId}:${s.dueDate}`, s]));
    const result: PlannedOccurrence[] = [];

    for (const rule of rules) {
      for (const dueDate of occurrencesOf(rule, from, to)) {
        const decision = settled.get(`${rule.id}:${dueDate}`);
        result.push({
          plannedId: rule.id,
          name: rule.name,
          amount: rule.amount,
          categoryId: rule.categoryId,
          walletId: rule.walletId,
          dueDate,
          status: decision?.status ?? 'pending',
          transactionId: decision?.transactionId ?? null,
          recurrence: rule.recurrence,
        });
      }
    }

    result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
    await this.cacheWindow(profile.id, result).catch(() => undefined);
    return result;
  },

  /**
   * Быстрый слой календаря: ZSET со score = датой списания.
   *
   * Кэш производный — при промахе или сбое всё пересчитывается из PostgreSQL,
   * поэтому его потеря ничего не стоит.
   */
  async cacheWindow(profileId: string, items: PlannedOccurrence[]): Promise<void> {
    const key = rkey.planned(profileId);
    const pipe = redis.pipeline();
    pipe.del(key);
    for (const o of items) {
      if (o.status !== 'pending') continue;
      pipe.zadd(key, Date.parse(`${o.dueDate}T00:00:00.000Z`) / 1000, `${o.plannedId}:${o.dueDate}`);
    }
    pipe.expire(key, 2 * 24 * 60 * 60);
    await pipe.exec();
  },

  /**
   * Сводка: сколько на самом деле свободно.
   *
   * Из баланса вычитаются только НЕОПЛАЧЕННЫЕ обязательства до конца периода:
   * подтверждённые уже ушли из баланса настоящей тратой, и вычитать их второй
   * раз значило бы занизить остаток вдвое.
   */
  async summary(profile: ProfileScope): Promise<PlannedSummary> {
    const period = periodOf(new Date(), profile.monthStartDay);
    const { end } = periodRange(period, profile.monthStartDay);
    const today = midnight(new Date());
    const days = Math.max(1, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));

    const [wallets, items] = await Promise.all([
      walletsRepository.listByProfile(profile.id),
      this.occurrences(profile, today, days),
    ]);

    const balance = wallets.reduce((sum, w) => sum + w.balance, 0);
    const pending = items.filter((o) => o.status === 'pending');
    const upcoming = pending.reduce((sum, o) => sum + o.amount, 0);
    const next = pending[0];

    return {
      period,
      balance,
      upcoming,
      free: balance - upcoming,
      nextDueDate: next?.dueDate ?? null,
      nextName: next?.name ?? null,
    };
  },

  /**
   * Подтвердить списание: событие превращается в настоящую трату.
   *
   * Решение и сама операция пишутся одной транзакцией — иначе при сбое между
   * ними деньги ушли бы, а событие осталось ожидающим, и пользователь оплатил
   * бы аренду дважды.
   */
  async confirm(
    profile: ProfileScope,
    plannedId: string,
    dueDate: string,
  ): Promise<PlannedOccurrence> {
    const rule = await plannedRepository.findOwned(pool, profile.id, plannedId);
    const categoryId = rule.categoryId;
    if (!categoryId) {
      throw new ValidationError('У события нет категории — укажите её, чтобы записать трату');
    }

    const walletId =
      rule.walletId ?? (await walletsRepository.listByProfile(profile.id))[0]?.id ?? null;
    if (!walletId) throw new ValidationError('Нет кошелька, с которого списать');

    const { txId, period } = await withTransaction(async (client) => {
      const wallet = await walletsRepository.findOwned(client, profile.id, walletId, true);
      if (wallet.balance - rule.amount < 0) {
        throw new ConflictError('Недостаточно средств в кошельке');
      }

      // Решение сначала: конфликт по (planned_id, due_date) остановит повторное
      // подтверждение до того, как деньги будут списаны.
      const fresh = await plannedRepository.settle(client, rule.id, dueDate, 'paid', null);
      if (!fresh) throw new ConflictError('Это списание уже отмечено');

      const occurredAt = new Date(`${dueDate}T12:00:00.000Z`);
      await walletsRepository.applyDelta(client, wallet.id, -rule.amount);
      const tx = await transactionsRepository.insert(client, {
        profileId: profile.id,
        type: 'spend',
        walletId: wallet.id,
        categoryId,
        amount: rule.amount,
        subcategory: null,
        comment: rule.name,
        occurredAt,
      });
      await client.query(
        'UPDATE planned_settlements SET transaction_id = $3 WHERE planned_id = $1 AND due_date = $2::date',
        [rule.id, dueDate, tx.id],
      );

      return { txId: tx.id, period: periodOf(occurredAt, profile.monthStartDay) };
    });

    // Кэш производный: пересобираем то, что подтверждение сдвинуло.
    const spent = await transactionsRepository.sumSpent(
      pool,
      profile.id,
      categoryId,
      period,
      profile.monthStartDay,
    );
    const wallet = await walletsRepository.findOwned(pool, profile.id, walletId);
    const pipe = redis.pipeline();
    cache.setWalletBalance(profile.id, wallet.id, wallet.balance, pipe);
    cache.setSpent(profile.id, period, categoryId, spent, pipe);
    await pipe.exec().catch(() => undefined);

    return {
      plannedId: rule.id,
      name: rule.name,
      amount: rule.amount,
      categoryId,
      walletId,
      dueDate,
      status: 'paid',
      transactionId: txId,
      recurrence: rule.recurrence,
    };
  },

  /**
   * Сумма неоплаченных обязательств от сегодня до конца периода.
   *
   * Отдельный лёгкий метод для прогноза: тому не нужны ни список событий, ни
   * балансы кошельков — только одно число.
   */
  async upcomingTotal(profile: ProfileScope, period: string): Promise<number> {
    const { end } = periodRange(period, profile.monthStartDay);
    const today = midnight(new Date());
    if (end.getTime() <= today.getTime()) return 0;
    const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
    const items = await this.occurrences(profile, today, days);
    return items.filter((o) => o.status === 'pending').reduce((sum, o) => sum + o.amount, 0);
  },

  /** Пропустить списание: денег не трогаем, но из обязательств оно уходит. */
  async skip(profile: ProfileScope, plannedId: string, dueDate: string): Promise<PlannedOccurrence> {
    const rule = await plannedRepository.findOwned(pool, profile.id, plannedId);
    const fresh = await plannedRepository.settle(pool, rule.id, dueDate, 'skipped', null);
    if (!fresh) throw new ConflictError('Это списание уже отмечено');
    return {
      plannedId: rule.id,
      name: rule.name,
      amount: rule.amount,
      categoryId: rule.categoryId,
      walletId: rule.walletId,
      dueDate,
      status: 'skipped',
      transactionId: null,
      recurrence: rule.recurrence,
    };
  },
};
