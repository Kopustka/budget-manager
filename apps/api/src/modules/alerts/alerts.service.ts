import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { rkey } from '../../redis/keys.js';
import { scripts } from '../../redis/scripts.js';
import { dayIndexInPeriod, daysInPeriod, periodOf, periodRange } from '../../shared/period.js';
import { analyticsService } from '../analytics/analytics.service.js';
import { plannedService } from '../planned/planned.service.js';
import { alertsQueue, pushOnce } from './alerts.queue.js';
import type {
  AlertBase,
  BotAlert,
  LimitReachedAlert,
  OverdraftAlert,
} from './alerts.types.js';

/** Во сколько (по UTC) уходит вечерний отчёт «День в цифрах». */
const DIGEST_HOUR_UTC = 18;

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
   * Запланировать вечерние отчёты «День в цифрах».
   *
   * Один отчёт на профиль в сутки, только по активному профилю аккаунта.
   * В очередь кладётся адресация без цифр — их подставит `hydrateAlert` в
   * момент доставки, иначе к вечеру они устареют.
   */
  async scheduleDailyDigests(now: Date = new Date()): Promise<number> {
    const dayKey = now.toISOString().slice(0, 10);
    const sendAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC, 0, 0),
    );

    const { rows } = await pool.query<{ id: string; telegram_id: string; currency: string }>(
      `SELECT p.id, u.telegram_id, p.currency
         FROM users u
         JOIN profiles p ON p.id = u.active_profile_id`,
    );

    let scheduled = 0;
    for (const row of rows) {
      const alert: BotAlert = {
        kind: 'daily_digest',
        profileId: row.id,
        telegramId: Number(row.telegram_id),
        currency: row.currency,
        queuedAt: now.toISOString(),
        day: dayKey,
      };
      const ok = await pushOnceScheduled(alert, dayKey, sendAt);
      if (ok) scheduled += 1;
    }
    return scheduled;
  },

  /**
   * Предупредить о завтрашних списаниях из календаря.
   *
   * Только неподтверждённые: если человек уже отметил оплату, напоминать не о
   * чем. Дедупликация по дате и событию — одно предупреждение на списание.
   */
  async schedulePlannedDue(now: Date = new Date()): Promise<number> {
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const dayKey = tomorrow.toISOString().slice(0, 10);

    const { rows } = await pool.query<{
      id: string;
      telegram_id: string;
      currency: string;
      month_start_day: number;
    }>(
      `SELECT p.id, u.telegram_id, p.currency, p.month_start_day
         FROM users u
         JOIN profiles p ON p.id = u.active_profile_id`,
    );

    let queued = 0;
    for (const row of rows) {
      const scope = {
        id: row.id,
        telegramId: Number(row.telegram_id),
        currency: row.currency,
        monthStartDay: row.month_start_day,
      } as ProfileScope;

      const due = (await plannedService.occurrences(scope, tomorrow, 1)).filter(
        (o) => o.status === 'pending',
      );

      for (const item of due) {
        const ok = await pushOnce(
          {
            telegramId: scope.telegramId,
            profileId: scope.id,
            currency: scope.currency,
            queuedAt: now.toISOString(),
            kind: 'planned_due',
            name: item.name,
            amount: item.amount,
            dueDate: item.dueDate,
          },
          `${dayKey}:${item.plannedId}`,
          2 * DAY_SECONDS,
        );
        if (ok) queued += 1;
      }
    }
    return queued;
  },

  /**
   * Подставить в отчёт актуальные цифры перед отправкой.
   *
   * Остальные виды пушей проходят насквозь: их числа верны на момент события,
   * и пересчитывать их поздно и незачем.
   */
  async hydrateAlert(alert: BotAlert): Promise<BotAlert> {
    if (alert.kind !== 'daily_digest') return alert;

    const { rows: profileRows } = await pool.query<{ month_start_day: number }>(
      'SELECT month_start_day FROM profiles WHERE id = $1',
      [alert.profileId],
    );
    const monthStartDay = profileRows[0]?.month_start_day ?? 1;
    const day = new Date(`${alert.day}T12:00:00.000Z`);
    const period = periodOf(day, monthStartDay);
    const { start, end } = periodRange(period, monthStartDay);

    const [todayRow, budgetRow, spentRow, overRow] = await Promise.all([
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
          WHERE profile_id = $1 AND type = 'spend'
            AND occurred_at >= $2::date AND occurred_at < ($2::date + interval '1 day')`,
        [alert.profileId, alert.day],
      ),
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
           FROM category_limits cl JOIN categories c ON c.id = cl.category_id
          WHERE c.profile_id = $1 AND cl.period = $2`,
        [alert.profileId, period],
      ),
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
          WHERE profile_id = $1 AND type = 'spend'
            AND occurred_at >= $2 AND occurred_at < $3`,
        [alert.profileId, start, end],
      ),
      // Вышли ли хоть по одной категории за её собственный лимит: общий остаток
      // может быть в плюсе, а конкретная категория — уже пробита.
      pool.query<{ n: string }>(
        `SELECT count(*) AS n
           FROM category_limits cl
           JOIN categories c ON c.id = cl.category_id
          WHERE c.profile_id = $1 AND cl.period = $2
            AND cl.limit_amount < (
              SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
               WHERE t.category_id = c.id AND t.type = 'spend'
                 AND t.occurred_at >= $3 AND t.occurred_at < $4
            )`,
        [alert.profileId, period, start, end],
      ),
    ]);

    const spentToday = Number(todayRow.rows[0]?.total ?? 0);
    const budgetRaw = Number(budgetRow.rows[0]?.total ?? 0);
    const budget = budgetRaw > 0 ? budgetRaw : null;
    const spentPeriod = Number(spentRow.rows[0]?.total ?? 0);

    let noSpendStreak = 0;
    if (spentToday === 0) {
      const scope = { id: alert.profileId, monthStartDay } as ProfileScope;
      noSpendStreak = (await analyticsService.noSpendDays(scope, period)).currentStreak;
    }

    return {
      ...alert,
      spentToday,
      budget,
      remaining: budget === null ? null : budget - spentPeriod,
      overLimit: Number(overRow.rows[0]?.n ?? 0) > 0,
      noSpendStreak,
    };
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
