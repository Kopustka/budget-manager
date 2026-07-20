import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/auth.js';
import { requireProfile } from '../../shared/current-profile.js';
import { periodOf } from '../../shared/period.js';
import { analyticsService } from './analytics.service.js';

/** Аналитика: donut-распределение и velocity-тренд. */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { period?: string } }>('/analytics/distribution', async (req) => {
    const profile = requireProfile(req);
    return analyticsService.distribution(
      profile,
      req.query.period ?? periodOf(new Date(), profile.monthStartDay),
    );
  });

  /** Прогноз исчерпания бюджета по среднему темпу трат. */
  app.get<{ Querystring: { period?: string } }>('/analytics/forecast', async (req) => {
    const profile = requireProfile(req);
    return analyticsService.forecast(
      profile,
      req.query.period ?? periodOf(new Date(), profile.monthStartDay),
    );
  });

  /** Дни без трат и серии. */
  app.get<{ Querystring: { period?: string } }>('/analytics/no-spend', async (req) => {
    const profile = requireProfile(req);
    return analyticsService.noSpendDays(
      profile,
      req.query.period ?? periodOf(new Date(), profile.monthStartDay),
    );
  });

  app.get<{ Querystring: { period?: string } }>('/analytics/velocity', async (req) => {
    const profile = requireProfile(req);
    return analyticsService.velocity(
      profile,
      req.query.period ?? periodOf(new Date(), profile.monthStartDay),
    );
  });
}
