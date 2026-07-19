import type {
  DistributionResponse,
  User,
  VelocityResponse,
  VelocityPoint,
} from '@budget/shared';
import { pool } from '../../config/db.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { transactionsRepository } from '../transactions/transactions.repository.js';
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
  async distribution(user: User, period: string): Promise<DistributionResponse> {
    assertPeriod(period);
    const userId = user.id;
    const [rows, categories] = await Promise.all([
      transactionsRepository.spentByCategory(userId, period, user.monthStartDay),
      categoriesRepository.listByUser(userId, 'expense'),
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
   * Velocity: факт нарастающим итогом против идеальной равномерной кривой
   * (сумма лимитов, размазанная по дням периода).
   */
  async velocity(user: User, period: string): Promise<VelocityResponse> {
    assertPeriod(period);
    const userId = user.id;
    const [daily, budgetRow] = await Promise.all([
      transactionsRepository.spentByDay(userId, period, user.monthStartDay),
      pool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(cl.limit_amount), 0) AS total
           FROM category_limits cl
           JOIN categories c ON c.id = cl.category_id
          WHERE c.user_id = $1 AND cl.period = $2`,
        [userId, period],
      ),
    ]);

    const budgetRaw = Number(budgetRow.rows[0]?.total ?? 0);
    const budget = budgetRaw > 0 ? budgetRaw : null;
    const days = daysInPeriod(period, user.monthStartDay);
    const spentByDay = new Map(daily.map((d) => [d.day, d.total]));
    const { start } = periodRange(period, user.monthStartDay);

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
      periodOf(now, user.monthStartDay) === period
        ? Math.min(dayIndexInPeriod(now, period, user.monthStartDay), days - 1)
        : days - 1;
    const at = points[index];
    const pace = at ? at.cumulative - at.ideal : 0;

    return { period, total: cumulative, budget, points, pace };
  },
};
