import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { currentPeriod } from '../../redis/keys.js';
import { analyticsService } from './analytics.service.js';

/** Аналитика: donut-распределение и velocity-тренд. */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { period?: string } }>('/analytics/distribution', async (req) => {
    const user = requireUser(req);
    return analyticsService.distribution(user.id, req.query.period ?? currentPeriod());
  });

  app.get<{ Querystring: { period?: string } }>('/analytics/velocity', async (req) => {
    const user = requireUser(req);
    return analyticsService.velocity(user.id, req.query.period ?? currentPeriod());
  });
}
