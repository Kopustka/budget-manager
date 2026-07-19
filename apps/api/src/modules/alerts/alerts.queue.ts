import { redis } from '../../config/redis.js';
import { rkey } from '../../redis/keys.js';
import type { BotAlert } from './alerts.types.js';

/**
 * Очередь пушей на Redis.
 *
 * Мгновенные уведомления — LIST (LPUSH/BRPOP): воркер спит на блокирующем чтении
 * и не крутит пустой цикл. Отложенные — ZSET со score = временем отправки;
 * их переносит в LIST `promoteDue`, поэтому у воркера одна точка приёма.
 */
export const alertsQueue = {
  async push(alert: BotAlert): Promise<void> {
    await redis.lpush(rkey.botAlertsQueue, JSON.stringify(alert));
  },

  /** Поставить пуш на конкретное время (вечерние напоминания). */
  async schedule(alert: BotAlert, sendAt: Date): Promise<void> {
    await redis.zadd(
      rkey.botAlertsScheduled,
      Math.floor(sendAt.getTime() / 1000),
      JSON.stringify(alert),
    );
  },

  /**
   * Перенести созревшие отложенные пуши в основную очередь.
   * Возвращает, сколько перенесено.
   */
  async promoteDue(now: Date = new Date()): Promise<number> {
    const score = Math.floor(now.getTime() / 1000);
    const due = await redis.zrangebyscore(rkey.botAlertsScheduled, '-inf', score);
    if (due.length === 0) return 0;

    const pipe = redis.pipeline();
    for (const payload of due) {
      pipe.lpush(rkey.botAlertsQueue, payload);
      pipe.zrem(rkey.botAlertsScheduled, payload);
    }
    await pipe.exec();
    return due.length;
  },

  /** Блокирующее чтение. null — за timeoutSec ничего не пришло. */
  async pop(timeoutSec = 5): Promise<BotAlert | null> {
    const result = await redis.brpop(rkey.botAlertsQueue, timeoutSec);
    if (!result) return null;
    const [, payload] = result;
    try {
      return JSON.parse(payload) as BotAlert;
    } catch {
      // Битую запись не возвращаем в очередь — иначе воркер зациклится на ней.
      return null;
    }
  },

  async size(): Promise<number> {
    return redis.llen(rkey.botAlertsQueue);
  },
};

/**
 * Поставить пуш не чаще одного раза на `scope` (категория+период, день и т.п.).
 * Возвращает false, если такой алерт уже отправляли и он ещё «горячий».
 */
export async function pushOnce(
  alert: BotAlert,
  scope: string,
  ttlSeconds: number,
): Promise<boolean> {
  const key = rkey.alertOnce(alert.userId, alert.kind, scope);
  const acquired = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  if (acquired !== 'OK') return false;
  await alertsQueue.push(alert);
  return true;
}
