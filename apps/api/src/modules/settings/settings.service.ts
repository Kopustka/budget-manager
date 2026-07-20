import type { ChangeCurrencyInput, SettingsResponse } from '@budget/shared';
import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool, withTransaction } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { ValidationError } from '../../shared/errors.js';
import { assertMonthStartDay, periodOf, periodRange } from '../../shared/period.js';

/**
 * Настройки профиля.
 *
 * Обе операции меняют смысл уже накопленных агрегатов, поэтому после каждой
 * сбрасываем производный кэш Redis: PostgreSQL — источник истины, кэш
 * пересоберётся при следующем запросе.
 */

/** Удалить кэш трат и лимитов профиля. */
async function dropAggregateCache(profileId: string): Promise<void> {
  const patterns = [
    `${env.REDIS_NAMESPACE}:profile:${profileId}:spent:*`,
    `${env.REDIS_NAMESPACE}:profile:${profileId}:limits:*`,
    `${env.REDIS_NAMESPACE}:profile:${profileId}:wallets`,
  ];
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
}

export interface CurrencyChangeResult {
  currency: string;
  rate: number;
  wallets: number;
  transactions: number;
  limits: number;
}

export const settingsService = {
  /** Текущие настройки вместе с границами периода — чтобы UI показал, что получилось. */
  describe(profile: ProfileScope): SettingsResponse {
    const period = periodOf(new Date(), profile.monthStartDay);
    const { start, end } = periodRange(period, profile.monthStartDay);
    return {
      currency: profile.currency,
      monthStartDay: profile.monthStartDay,
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      profileId: profile.id,
      profileName: profile.name,
    };
  },

  /** Сменить день начала расчётного месяца. */
  async setMonthStartDay(profile: ProfileScope, day: number): Promise<SettingsResponse> {
    assertMonthStartDay(day);
    await pool.query('UPDATE profiles SET month_start_day = $2 WHERE id = $1', [profile.id, day]);
    // Накопленные spent считались по старым границам — они больше не верны.
    await dropAggregateCache(profile.id);
    return this.describe({ ...profile, monthStartDay: day });
  },

  /**
   * Сменить валюту с пересчётом всех сумм по указанному курсу.
   *
   * Операция необратима, поэтому идёт одной транзакцией и фиксируется в
   * currency_conversions: по этой таблице видно, каким курсом и когда были
   * умножены суммы.
   */
  async changeCurrency(profile: ProfileScope, input: ChangeCurrencyInput): Promise<CurrencyChangeResult> {
    if (input.currency === profile.currency && input.rate === 1) {
      throw new ValidationError('Валюта уже установлена, пересчёт не требуется');
    }

    const result = await withTransaction(async (client) => {
      // ROUND(...) в PostgreSQL, чтобы не гонять суммы через JS-числа:
      // amount остаётся целым в минорных единицах новой валюты.
      const wallets = await client.query(
        `UPDATE wallets
            SET balance = ROUND(balance * $2::numeric),
                currency = $3
          WHERE profile_id = $1`,
        [profile.id, input.rate, input.currency],
      );

      const transactions = await client.query(
        `UPDATE transactions
            SET amount = GREATEST(ROUND(amount * $2::numeric), 1)
          WHERE profile_id = $1`,
        [profile.id, input.rate],
      );

      const limits = await client.query(
        `UPDATE category_limits cl
            SET limit_amount = ROUND(cl.limit_amount * $2::numeric)
          FROM categories c
          WHERE c.id = cl.category_id AND c.profile_id = $1`,
        [profile.id, input.rate],
      );

      await client.query('UPDATE profiles SET currency = $2 WHERE id = $1', [
        profile.id,
        input.currency,
      ]);

      await client.query(
        `INSERT INTO currency_conversions
           (profile_id, from_currency, to_currency, rate, wallets_count, transactions_count, limits_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          profile.id,
          profile.currency,
          input.currency,
          input.rate,
          wallets.rowCount ?? 0,
          transactions.rowCount ?? 0,
          limits.rowCount ?? 0,
        ],
      );

      return {
        currency: input.currency,
        rate: input.rate,
        wallets: wallets.rowCount ?? 0,
        transactions: transactions.rowCount ?? 0,
        limits: limits.rowCount ?? 0,
      };
    });

    await dropAggregateCache(profile.id);
    return result;
  },
};
