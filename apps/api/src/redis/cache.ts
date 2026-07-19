import type { ChainableCommander } from 'ioredis';
import { redis } from '../config/redis.js';
import { rkey } from './keys.js';

/**
 * Репозиторий быстрого слоя. Методы чтения работают напрямую;
 * методы записи принимают опциональный pipeline (ChainableCommander),
 * чтобы участвовать в атомарной Redis Pipeline вместе с PG-транзакцией (Фаза 2).
 */
export const cache = {
  // ── Балансы кошельков ──
  async getWalletBalance(userId: string, walletId: string): Promise<number | null> {
    const v = await redis.hget(rkey.wallets(userId), walletId);
    return v === null ? null : Number(v);
  },

  setWalletBalance(
    userId: string,
    walletId: string,
    balance: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hset(rkey.wallets(userId), walletId, String(balance));
  },

  // ── Накопленные траты по категории ──
  async getSpent(userId: string, period: string, categoryId: string): Promise<number> {
    const v = await redis.hget(rkey.spent(userId, period), categoryId);
    return v === null ? 0 : Number(v);
  },

  incrSpent(
    userId: string,
    period: string,
    categoryId: string,
    delta: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hincrby(rkey.spent(userId, period), categoryId, delta);
  },

  // ── Лимиты по категории ──
  async getLimit(userId: string, period: string, categoryId: string): Promise<number | null> {
    const v = await redis.hget(rkey.limits(userId, period), categoryId);
    return v === null ? null : Number(v);
  },

  setLimit(
    userId: string,
    period: string,
    categoryId: string,
    limit: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hset(rkey.limits(userId, period), categoryId, String(limit));
  },

  // ── Скользящее окно истории (ZSET 30d) ──
  addTxToCache(
    userId: string,
    txId: string,
    occurredAtUnix: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).zadd(rkey.txCache30d(userId), occurredAtUnix, txId);
  },

  /** Подрезать окно: удалить всё старше (now - 30d). */
  trimTxCache(userId: string, nowUnix: number, pipe?: ChainableCommander): void {
    const cutoff = nowUnix - 30 * 24 * 60 * 60;
    (pipe ?? redis).zremrangebyscore(rkey.txCache30d(userId), '-inf', cutoff);
  },
};
