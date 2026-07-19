import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { pool } from './config/db.js';
import { redis } from './config/redis.js';
import { AppError } from './shared/errors.js';
import { env } from './config/env.js';

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

  // Единый обработчик ошибок → JSON { error: { code, message } }
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
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

  return app;
}
