import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { redis } from './config/redis.js';

const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Получен ${signal}, останавливаемся...`);
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start();
