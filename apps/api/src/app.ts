import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { pool } from './config/db.js';
import { redis } from './config/redis.js';
import { AppError, ValidationError } from './shared/errors.js';
import { env } from './config/env.js';
import { usersRoutes } from './modules/users/users.controller.js';
import { walletsRoutes } from './modules/wallets/wallets.controller.js';
import { categoriesRoutes } from './modules/categories/categories.controller.js';
import { transactionsRoutes } from './modules/transactions/transactions.controller.js';
import { analyticsRoutes } from './modules/analytics/analytics.controller.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Пустое тело при content-type: application/json — норма для DELETE и запросов
  // без полезной нагрузки, не ошибка парсинга.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || body.trim() === '') return done(null, undefined);
      try {
        done(null, JSON.parse(body));
      } catch {
        done(new ValidationError('Тело запроса — невалидный JSON'), undefined);
      }
    },
  );

  // Единый обработчик ошибок → JSON { error: { code, message } }
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
      return;
    }
    // Ошибки самого Fastify (роутинг, парсинг) уже несут корректный 4xx — не прячем их под 500.
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      reply.status(status).send({
        error: { code: err.code ?? 'BAD_REQUEST', message: err.message },
      });
      return;
    }
    app.log.error(err);
    reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' },
    });
  });

  // Healthcheck: проверяем PG и Redis.
  app.get('/health', async (_req, reply) => {
    const health: { status: string; pg: boolean; redis: boolean } = {
      status: 'ok',
      pg: false,
      redis: false,
    };
    try {
      await pool.query('SELECT 1');
      health.pg = true;
    } catch {
      health.status = 'degraded';
    }
    try {
      const pong = await redis.ping();
      health.redis = pong === 'PONG';
      if (!health.redis) health.status = 'degraded';
    } catch {
      health.status = 'degraded';
    }
    reply.status(health.status === 'ok' ? 200 : 503).send(health);
  });

  // Модули (FDD): каждый регистрируется как плагин со своим auth-хуком.
  app.register(usersRoutes, { prefix: '/api' });
  app.register(walletsRoutes, { prefix: '/api' });
  app.register(categoriesRoutes, { prefix: '/api' });
  app.register(transactionsRoutes, { prefix: '/api' });
  app.register(analyticsRoutes, { prefix: '/api' });

  return app;
}
