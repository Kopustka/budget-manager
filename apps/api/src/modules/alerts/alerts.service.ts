import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { rkey } from '../../redis/keys.js';
import { scripts } from '../../redis/scripts.js';
import { dayIndexInPeriod, daysInPeriod, periodRange } from '../../shared/period.js';
import { alertsQueue, pushOnce } from './alerts.queue.js';
import type {
  AlertBase,
  BotAlert,
  LimitReachedAlert,
  OverdraftAlert,
} from './alerts.types.js';

/** Во сколько (по UTC) слать вечернее напоминание записать траты. */
const REMINDER_HOUR_UTC = 18;

/** Порог «слишком быстро»: дневная трата вдвое выше равномерной доли бюджета. */
const FAST_PACE_FACTOR = 2;

const DAY_SECONDS = 24 * 60 * 60;

/** Дедупликатор пуша по лимиту живёт период с запасом — по одному на категорию. */
const LIMIT_ALERT_TTL = 31 * DAY_SECONDS;

/**
 * Плейсхолдер суммы лимита в payload'е. Настоящее значение подставит Lua-скрипт
 * тем числом, с которым реально сравнивал: только оно объясняет, почему пуш
 * сработал. Лимит неотрицателен, поэтому -1 не встретится в данных.
 */
const LIMIT_PLACEHOLDER = -1;

/** Общие поля адресации для любого пуша. */
function base(profile: ProfileScope): AlertBase {
  return {
    telegramId: profile.telegramId,
    profileId: profile.id,
    currency: profile.currency,
    queuedAt: new Date().toISOString(),
  };
}

export const alertsService = {
  /**
   * Зафиксировать трату в быстром слое и проверить лимит категории — одним
   * атомарным EVAL (см. redis/scripts.ts).
   *
   * Записать spent, сравнить его с лимитом и поставить пуш нельзя порознь:
   * между round-trip'ами влезает параллельная трата по той же категории, и
   * превышение либо остаётся незамеченным, либо порождает два уведомления.
   *
   * Возвращает вид поставленного пуша или null, если повода не было (или такой
   * пуш за период уже отправляли).
   */
  async settleSpend(input: {
    profile: ProfileScope;
    categoryId: string;
    categoryName: string;
    /** Точный spent за период, посчитанный в PostgreSQL после коммита. */
    spent: number;
    /** Лимит, известный вызывающему; идёт в дело только при промахе кэша. */
    limit: number | null;
    period: string;
  }): Promise<'overdraft' | 'limit_reached' | null> {
    const { profile, categoryId, categoryName, spent, limit, period } = input;
    const common = { ...base(profile), categoryName, spent, limit: LIMIT_PLACEHOLDER };
    const scope = `${period}:${categoryId}`;

    const [, kind] = await scripts.settleSpend(
      rkey.spent(profile.id, period),
      rkey.limits(profile.id, period),
      rkey.alertOnce(profile.id, 'overdraft', scope),
      rkey.alertOnce(profile.id, 'limit_reached', scope),
      rkey.botAlertsQueue,
      categoryId,
      String(spent),
      limit === null ? '' : String(limit),
      String(LIMIT_ALERT_TTL),
      JSON.stringify({ ...common, kind: 'overdraft' } satisfies OverdraftAlert),
      JSON.stringify({ ...common, kind: 'limit_reached' } satisfies LimitReachedAlert),
    );

    return kind === '' ? null : (kind as 'overdraft' | 'limit_reached');
  },

  /** Сравнить траты за день с равномерной дневной долей бюджета. */
  async checkDailyPace(profile: ProfileScope, day: Date, period: string): Promise<boolean> {
    const { rows: budgetRows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
         FROM category_limits cl
         JOIN categories c ON c.id = cl.category_id
        WHERE c.profile_id = $1 AND cl.period = $2`,
      [profile.id, period],
    );
    const budget = Number(budgetRows[0]?.total ?? 0);
    if (budget <= 0) return false; // без лимитов «быстро» не определить

    const dailyBudget = Math.round(budget / daysInPeriod(period, profile.monthStartDay));
    const dayKey = day.toISOString().slice(0, 10);
    const { rows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE profile_id = $1 AND type = 'spend'
          AND occurred_at >= $2::date AND occurred_at < ($2::date + interval '1 day')`,
      [profile.id, dayKey],
    );
    const spentToday = Number(rows[0]?.total ?? 0);
    if (spentToday < dailyBudget * FAST_PACE_FACTOR) return false;

    /**
     * Одной дневной траты мало: кто неделю не тратил, а сегодня закупился, —
     * всё ещё в графике. Ругаемся, только если и накопленный факт обогнал
     * накопленный план, иначе уведомление ложное и его перестают читать.
     */
    const { start } = periodRange(period, profile.monthStartDay);
    const { rows: cumulativeRows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE profile_id = $1 AND type = 'spend'
          AND occurred_at >= $2 AND occurred_at < ($3::date + interval '1 day')`,
      [profile.id, start, dayKey],
    );
    const cumulative = Number(cumulativeRows[0]?.total ?? 0);
    // Позиция дня внутри периода, а не число месяца: при сдвинутом дне начала
    // это разные величины, и план на «сегодня» считался бы неверно.
    const dayNumber = dayIndexInPeriod(day, period, profile.monthStartDay) + 1;
    if (cumulative <= dailyBudget * dayNumber) return false;

    return pushOnce(
      { ...base(profile), kind: 'fast_pace', spentToday, dailyBudget },
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

    /*
     * Только активный профиль каждого аккаунта: уведомления приходят по тому
     * бюджету, который человек сейчас ведёт. Иначе три профиля давали бы три
     * напоминания за вечер, и их перестали бы читать.
     */
    const { rows } = await pool.query<{ id: string; telegram_id: string; currency: string }>(
      `SELECT p.id, u.telegram_id, p.currency
         FROM users u
         JOIN profiles p ON p.id = u.active_profile_id
        WHERE NOT EXISTS (
          SELECT 1 FROM transactions t
           WHERE t.profile_id = p.id
             AND t.occurred_at >= $1::date
             AND t.occurred_at < ($1::date + interval '1 day')
        )`,
      [dayKey],
    );

    let scheduled = 0;
    for (const row of rows) {
      const alert: BotAlert = {
        kind: 'evening_reminder',
        profileId: row.id,
        telegramId: Number(row.telegram_id),
        currency: row.currency,
        queuedAt: now.toISOString(),
      };
      // Дедупликация: одно напоминание на профиль в сутки.
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
    rkey.alertOnce(alert.profileId, alert.kind, scope),
    '1',
    'EX',
    DAY_SECONDS,
    'NX',
  );
  if (acquired !== 'OK') return false;
  await alertsQueue.schedule(alert, sendAt);
  return true;
}
