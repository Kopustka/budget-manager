import type { User } from '@budget/shared';
import { pool } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { rkey } from '../../redis/keys.js';
import { daysInPeriod, periodRange } from '../../shared/period.js';
import { alertsQueue, pushOnce } from './alerts.queue.js';
import type { AlertBase, BotAlert } from './alerts.types.js';

/** Во сколько (по UTC) слать вечернее напоминание записать траты. */
const REMINDER_HOUR_UTC = 18;

/** Порог «слишком быстро»: дневная трата вдвое выше равномерной доли бюджета. */
const FAST_PACE_FACTOR = 2;

const DAY_SECONDS = 24 * 60 * 60;

/** Общие поля адресации для любого пуша. */
function base(user: User): AlertBase {
  return {
    telegramId: user.telegramId,
    userId: user.id,
    queuedAt: new Date().toISOString(),
  };
}

export const alertsService = {
  /**
   * Оценить триггеры после списания и поставить пуши в очередь.
   *
   * Вызывается после коммита операции и никогда её не роняет: уведомление —
   * побочный эффект, его сбой не повод откатывать деньги (вызывающий код
   * гасит исключения).
   */
  async evaluateAfterSpend(input: {
    user: User;
    categoryId: string;
    categoryName: string;
    spent: number;
    limit: number | null;
    period: string;
    occurredAt: Date;
  }): Promise<string[]> {
    const fired: string[] = [];
    const { user, categoryName, spent, limit, period } = input;

    if (limit !== null && spent > limit) {
      // Превышение — самое важное событие, шлём один раз на категорию за период.
      const ok = await pushOnce(
        { ...base(user), kind: 'overdraft', categoryName, spent, limit },
        `${period}:${input.categoryId}`,
        31 * DAY_SECONDS,
      );
      if (ok) fired.push('overdraft');
    } else if (limit !== null && spent >= limit) {
      const ok = await pushOnce(
        { ...base(user), kind: 'limit_reached', categoryName, spent, limit },
        `${period}:${input.categoryId}`,
        31 * DAY_SECONDS,
      );
      if (ok) fired.push('limit_reached');
    }

    const pace = await this.checkDailyPace(user, input.occurredAt, period);
    if (pace) fired.push('fast_pace');

    return fired;
  },

  /** Сравнить траты за день с равномерной дневной долей бюджета. */
  async checkDailyPace(user: User, day: Date, period: string): Promise<boolean> {
    const { rows: budgetRows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
         FROM category_limits cl
         JOIN categories c ON c.id = cl.category_id
        WHERE c.user_id = $1 AND cl.period = $2`,
      [user.id, period],
    );
    const budget = Number(budgetRows[0]?.total ?? 0);
    if (budget <= 0) return false; // без лимитов «быстро» не определить

    const dailyBudget = Math.round(budget / daysInPeriod(period));
    const dayKey = day.toISOString().slice(0, 10);
    const { rows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE user_id = $1 AND type = 'spend'
          AND occurred_at >= $2::date AND occurred_at < ($2::date + interval '1 day')`,
      [user.id, dayKey],
    );
    const spentToday = Number(rows[0]?.total ?? 0);
    if (spentToday < dailyBudget * FAST_PACE_FACTOR) return false;

    /**
     * Одной дневной траты мало: кто неделю не тратил, а сегодня закупился, —
     * всё ещё в графике. Ругаемся, только если и накопленный факт обогнал
     * накопленный план, иначе уведомление ложное и его перестают читать.
     */
    const { start } = periodRange(period);
    const { rows: cumulativeRows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE user_id = $1 AND type = 'spend'
          AND occurred_at >= $2 AND occurred_at < ($3::date + interval '1 day')`,
      [user.id, start, dayKey],
    );
    const cumulative = Number(cumulativeRows[0]?.total ?? 0);
    const dayNumber = Number(dayKey.slice(-2));
    if (cumulative <= dailyBudget * dayNumber) return false;

    return pushOnce(
      { ...base(user), kind: 'fast_pace', spentToday, dailyBudget },
      dayKey,
      DAY_SECONDS,
    );
  },

  /**
   * Запланировать вечерние напоминания тем, кто сегодня ничего не записал.
   * Идемпотентно: повторный вызов за те же сутки ничего не добавит.
   */
  async scheduleEveningReminders(now: Date = new Date()): Promise<number> {
    const dayKey = now.toISOString().slice(0, 10);
    const sendAt = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        REMINDER_HOUR_UTC,
        0,
        0,
      ),
    );

    const { rows } = await pool.query<{ id: string; telegram_id: string }>(
      `SELECT u.id, u.telegram_id
         FROM users u
        WHERE NOT EXISTS (
          SELECT 1 FROM transactions t
           WHERE t.user_id = u.id
             AND t.occurred_at >= $1::date
             AND t.occurred_at < ($1::date + interval '1 day')
        )`,
      [dayKey],
    );

    let scheduled = 0;
    for (const row of rows) {
      const alert: BotAlert = {
        kind: 'evening_reminder',
        userId: row.id,
        telegramId: Number(row.telegram_id),
        queuedAt: now.toISOString(),
      };
      // Дедупликация: одно напоминание на пользователя в сутки.
      const ok = await pushOnceScheduled(alert, dayKey, sendAt);
      if (ok) scheduled += 1;
    }
    return scheduled;
  },
};

/** Отложенный аналог pushOnce: ставит в ZSET, если такого ещё не планировали. */
async function pushOnceScheduled(
  alert: BotAlert,
  scope: string,
  sendAt: Date,
): Promise<boolean> {
  const acquired = await redis.set(
    rkey.alertOnce(alert.userId, alert.kind, scope),
    '1',
    'EX',
    DAY_SECONDS,
    'NX',
  );
  if (acquired !== 'OK') return false;
  await alertsQueue.schedule(alert, sendAt);
  return true;
}
