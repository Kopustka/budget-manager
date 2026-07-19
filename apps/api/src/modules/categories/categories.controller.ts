import type { FastifyInstance } from 'fastify';
import { setLimitSchema } from '@budget/shared';
import { pool } from '../../config/db.js';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { parseOrThrow } from '../../shared/validate.js';
import { cache } from '../../redis/cache.js';
import { periodOf } from '../../shared/period.js';
import { categoriesRepository } from './categories.repository.js';
import { transactionsRepository } from '../transactions/transactions.repository.js';

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Категории с текущими spent/limit — то, что рисует матрица. */
  app.get<{ Querystring: { kind?: 'income' | 'expense'; period?: string } }>(
    '/categories',
    async (req) => {
      const user = requireUser(req);
      const period = req.query.period ?? periodOf(new Date(), user.monthStartDay);
      const categories = await categoriesRepository.listByUser(user.id, req.query.kind);

      const items = await Promise.all(
        categories.map(async (c) => {
          if (c.kind !== 'expense') return { ...c, spent: null, limit: null, isOverdraft: false };
          const [spent, limit] = await Promise.all([
            transactionsRepository.sumSpent(pool, user.id, c.id, period, user.monthStartDay),
            categoriesRepository.findLimit(pool, c.id, period),
          ]);
          cache.setSpent(user.id, period, c.id, spent);
          if (limit !== null) cache.setLimit(user.id, period, c.id, limit);
          return { ...c, spent, limit, isOverdraft: limit !== null && spent > limit };
        }),
      );
      return { period, items };
    },
  );

  /** Установка/обновление лимита категории на период. */
  app.put<{ Params: { id: string } }>('/categories/:id/limit', async (req) => {
    const user = requireUser(req);
    const input = parseOrThrow(setLimitSchema, req.body);
    const category = await categoriesRepository.findOwned(pool, user.id, req.params.id);
    await categoriesRepository.setLimit(category.id, input.period, input.limitAmount);
    cache.setLimit(user.id, input.period, category.id, input.limitAmount);
    return { categoryId: category.id, period: input.period, limitAmount: input.limitAmount };
  });
}
