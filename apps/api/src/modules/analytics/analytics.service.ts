import {
  BURN_RATE_WINDOW_DAYS,
  FORECAST_TIGHT_DAYS,
  type DistributionResponse,
  type ForecastResponse,
  type ForecastVerdict,
  type NoSpendResponse,
  type VelocityResponse,
  type VelocityPoint,
} from '@budget/shared';
import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool } from '../../config/db.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { transactionsRepository } from '../transactions/transactions.repository.js';
import { plannedService } from '../planned/planned.service.js';
import {
  assertPeriod,
  dayIndexInPeriod,
  daysInPeriod,
  periodOf,
  periodRange,
} from '../../shared/period.js';

/** Аналитика периода. Читает из PostgreSQL — точные цифры важнее миллисекунд. */
export const analyticsService = {
  /** Распределение трат по категориям за период (donut). */
  async distribution(profile: ProfileScope, period: string): Promise<DistributionResponse> {
    assertPeriod(period);
    const profileId = profile.id;
    const [rows, categories] = await Promise.all([
      transactionsRepository.spentByCategory(profileId, period, profile.monthStartDay),
      categoriesRepository.listByProfile(profileId, 'expense'),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const total = rows.reduce((sum, r) => sum + r.total, 0);

    const limits = new Map<string, number | null>();
    for (const r of rows) {
      limits.set(r.categoryId, await categoriesRepository.findLimit(pool, r.categoryId, period));
    }

    return {
      period,
      total,
      items: rows.map((r) => {
        const category = byId.get(r.categoryId);
        const limit = limits.get(r.categoryId) ?? null;
        return {
          categoryId: r.categoryId,
          name: category?.name ?? 'Без категории',
          color: category?.color ?? null,
          icon: category?.icon ?? null,
          spent: r.total,
          limit,
          share: total > 0 ? r.total / total : 0,
          isOverdraft: limit !== null && r.total > limit,
        };
      }),
    };
  },


  /**
   * Прогноз исчерпания бюджета по среднему темпу трат (burn rate).
   *
   * Окно — последние ПОЛНЫЕ дни, заканчивая вчерашним. Сегодняшний день
   * намеренно не берём: он неполный и занижал бы темп тем сильнее, чем раньше
   * пользователь открыл приложение, — прогноз получался бы оптимистичнее правды.
   */
  async forecast(profile: ProfileScope, period: string): Promise<ForecastResponse> {
    assertPeriod(period);
    const profileId = profile.id;
    const { start, end } = periodRange(period, profile.monthStartDay);
    const now = new Date();

    const [budgetRow, spentRow, firstRow] = await Promise.all([
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
           FROM category_limits cl
           JOIN categories c ON c.id = cl.category_id
          WHERE c.profile_id = $1 AND cl.period = $2`,
        [profileId, period],
      ),
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(amount), 0) AS total
           FROM transactions
          WHERE profile_id = $1 AND type = 'spend'
            AND occurred_at >= $2 AND occurred_at < $3`,
        [profileId, start, end],
      ),
      pool.query<{ first: Date | null }>(
        `SELECT MIN(occurred_at) AS first FROM transactions WHERE profile_id = $1`,
        [profileId],
      ),
    ]);

    const budgetRaw = Number(budgetRow.rows[0]?.total ?? 0);
    const budget = budgetRaw > 0 ? budgetRaw : null;
    const spent = Number(spentRow.rows[0]?.total ?? 0);

    /*
     * Обязательства календаря вычитаем из остатка: аренда, которая спишется
     * через пять дней, уже не свободные деньги. Без этого прогноз обещал бы
     * запас, которого нет, — а именно от таких обещаний фича и должна защищать.
     */
    const upcoming = await plannedService.upcomingTotal(profile, period);
    const remaining = budget === null ? null : budget - spent - upcoming;

    // Окно наблюдения: [вчера-6, сегодня) — только завершившиеся сутки.
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const windowStart = new Date(todayStart.getTime() - BURN_RATE_WINDOW_DAYS * 86_400_000);

    // У нового профиля истории меньше окна — делить на 7 нельзя, иначе темп
    // окажется втрое ниже реального и прогноз соврёт в успокаивающую сторону.
    const first = firstRow.rows[0]?.first ?? null;
    const observedFrom = first && first > windowStart ? first : windowStart;
    const observedMs = todayStart.getTime() - observedFrom.getTime();
    const windowDays = Math.max(1, Math.min(BURN_RATE_WINDOW_DAYS, Math.round(observedMs / 86_400_000)));

    const { rows: burnRows } = await pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE profile_id = $1 AND type = 'spend'
          AND occurred_at >= $2 AND occurred_at < $3`,
      [profileId, new Date(todayStart.getTime() - windowDays * 86_400_000), todayStart],
    );
    const dailyBurn = Math.round(Number(burnRows[0]?.total ?? 0) / windowDays);

    // Сколько суток осталось в периоде, считая текущие неполные.
    const daysLeftInPeriod = Math.max(
      0,
      Math.ceil((end.getTime() - Math.max(now.getTime(), start.getTime())) / 86_400_000),
    );

    const daysLeftAtBurn =
      remaining === null || dailyBurn <= 0 ? null : Math.max(0, Math.floor(remaining / dailyBurn));

    let verdict: ForecastVerdict;
    if (budget === null) verdict = 'NO_BUDGET';
    else if (dailyBurn <= 0) verdict = 'NO_SPEND';
    else if (daysLeftAtBurn === null || daysLeftAtBurn < daysLeftInPeriod) verdict = 'SHORTFALL';
    else if (daysLeftAtBurn - daysLeftInPeriod <= FORECAST_TIGHT_DAYS) verdict = 'TIGHT';
    else verdict = 'ON_TRACK';

    return {
      period,
      verdict,
      dailyBurn,
      windowDays,
      budget,
      spent,
      upcoming,
      remaining,
      daysLeftAtBurn,
      daysLeftInPeriod,
    };
  },

  /**
   * Дни периода без единого расхода и серии таких дней.
   *
   * Зачисление дохода день не портит: «день без трат» — про то, что деньги не
   * уходили, а не про отсутствие любых записей.
   */
  async noSpendDays(profile: ProfileScope, period: string): Promise<NoSpendResponse> {
    assertPeriod(period);
    const profileId = profile.id;
    const { start, end } = periodRange(period, profile.monthStartDay);

    const [daily, firstRow] = await Promise.all([
      transactionsRepository.spentByDay(profileId, period, profile.monthStartDay),
      pool.query<{ first: Date | null }>(
        `SELECT MIN(occurred_at) AS first FROM transactions WHERE profile_id = $1`,
        [profileId],
      ),
    ]);

    const spentDays = new Set(daily.filter((d) => d.total > 0).map((d) => d.day));
    const now = new Date();

    /*
     * Считаем только дни, которые пользователь реально прожил с приложением:
     * от первой операции до сегодняшнего дня включительно. Иначе новый профиль
     * получил бы «серию» за весь месяц вперёд и назад, и она ничего не значила бы.
     */
    const first = firstRow.rows[0]?.first ?? null;
    const from = first && first > start ? first : start;
    const fromKey = from.toISOString().slice(0, 10);
    const lastMs = Math.min(now.getTime(), end.getTime() - 1);

    // Все прожитые дни периода по порядку — по ним считаются и серии, и итог.
    const observed: string[] = [];
    for (let t = start.getTime(); t <= lastMs; t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (day >= fromKey) observed.push(day);
    }

    const days = observed.filter((d) => !spentDays.has(d));

    let bestStreak = 0;
    let running = 0;
    for (const day of observed) {
      running = spentDays.has(day) ? 0 : running + 1;
      if (running > bestStreak) bestStreak = running;
    }

    // Текущая серия — с конца назад: последний прожитый день с тратой обрывает
    // её сразу, даже если раньше в периоде была длинная чистая полоса.
    let currentStreak = 0;
    for (let i = observed.length - 1; i >= 0; i -= 1) {
      if (spentDays.has(observed[i]!)) break;
      currentStreak += 1;
    }

    return { period, days, currentStreak, bestStreak, total: days.length };
  },

  /**
   * Velocity: факт нарастающим итогом против идеальной равномерной кривой
   * (сумма лимитов, размазанная по дням периода).
   */
  async velocity(profile: ProfileScope, period: string): Promise<VelocityResponse> {
    assertPeriod(period);
    const profileId = profile.id;
    const [daily, budgetRow] = await Promise.all([
      transactionsRepository.spentByDay(profileId, period, profile.monthStartDay),
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
           FROM category_limits cl
           JOIN categories c ON c.id = cl.category_id
          WHERE c.profile_id = $1 AND cl.period = $2`,
        [profileId, period],
      ),
    ]);

    const budgetRaw = Number(budgetRow.rows[0]?.total ?? 0);
    const budget = budgetRaw > 0 ? budgetRaw : null;
    const days = daysInPeriod(period, profile.monthStartDay);
    const spentByDay = new Map(daily.map((d) => [d.day, d.total]));
    const { start } = periodRange(period, profile.monthStartDay);

    const points: VelocityPoint[] = [];
    let cumulative = 0;
    for (let i = 0; i < days; i += 1) {
      const date = new Date(start.getTime() + i * 86_400_000);
      const day = date.toISOString().slice(0, 10);
      const spent = spentByDay.get(day) ?? 0;
      cumulative += spent;
      points.push({
        day,
        spent,
        cumulative,
        ideal: budget === null ? 0 : Math.round((budget * (i + 1)) / days),
      });
    }

    // Опережение считаем на сегодня, если период текущий; иначе — на конец периода.
    // Номер дня берём от начала периода: при сдвинутом дне начала календарное
    // число месяца уже не совпадает с позицией внутри периода.
    const now = new Date();
    const index =
      periodOf(now, profile.monthStartDay) === period
        ? Math.min(dayIndexInPeriod(now, period, profile.monthStartDay), days - 1)
        : days - 1;
    const at = points[index];
    const pace = at ? at.cumulative - at.ideal : 0;

    return { period, total: cumulative, budget, points, pace };
  },
};
