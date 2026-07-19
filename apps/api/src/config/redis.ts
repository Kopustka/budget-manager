import { Redis } from 'ioredis';
import { env } from './env.js';

/**
 * Redis — быстрый слой: балансы, накопленные траты/лимиты (проверка овердрафта <2мс),
 * скользящее окно истории (ZSET 30d), очередь пушей для бота.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Ошибка Redis', err);
});
