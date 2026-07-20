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
  async getWalletBalance(profileId: string, walletId: string): Promise<number | null> {
    const v = await redis.hget(rkey.wallets(profileId), walletId);
    return v === null ? null : Number(v);
  },

  setWalletBalance(
    profileId: string,
    walletId: string,
    balance: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hset(rkey.wallets(profileId), walletId, String(balance));
  },

  // ── Накопленные траты по категории ──
  async getSpent(profileId: string, period: string, categoryId: string): Promise<number> {
    const v = await redis.hget(rkey.spent(profileId, period), categoryId);
    return v === null ? 0 : Number(v);
  },

  incrSpent(
    profileId: string,
    period: string,
    categoryId: string,
    delta: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hincrby(rkey.spent(profileId, period), categoryId, delta);
  },

  /** Записать spent точным значением (после пересчёта из PG — источника истины). */
  setSpent(
    profileId: string,
    period: string,
    categoryId: string,
    spent: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hset(rkey.spent(profileId, period), categoryId, String(spent));
  },

  // ── Лимиты по категории ──
  async getLimit(profileId: string, period: string, categoryId: string): Promise<number | null> {
    const v = await redis.hget(rkey.limits(profileId, period), categoryId);
    return v === null ? null : Number(v);
  },

  setLimit(
    profileId: string,
    period: string,
    categoryId: string,
    limit: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).hset(rkey.limits(profileId, period), categoryId, String(limit));
  },

  /**
   * Снять лимит. Именно удаление поля, а не запись нуля: ноль — это «тратить
   * нельзя», и проверка лимита сработала бы на первой же копейке.
   */
  clearLimit(profileId: string, period: string, categoryId: string, pipe?: ChainableCommander): void {
    (pipe ?? redis).hdel(rkey.limits(profileId, period), categoryId);
  },

  // ── Скользящее окно истории (ZSET 30d) ──
  addTxToCache(
    profileId: string,
    txId: string,
    occurredAtUnix: number,
    pipe?: ChainableCommander,
  ): void {
    (pipe ?? redis).zadd(rkey.txCache30d(profileId), occurredAtUnix, txId);
  },

  removeTxFromCache(profileId: string, txId: string, pipe?: ChainableCommander): void {
    (pipe ?? redis).zrem(rkey.txCache30d(profileId), txId);
  },

  /** Подрезать окно: удалить всё старше (now - 30d). */
  trimTxCache(profileId: string, nowUnix: number, pipe?: ChainableCommander): void {
    const cutoff = nowUnix - 30 * 24 * 60 * 60;
    (pipe ?? redis).zremrangebyscore(rkey.txCache30d(profileId), '-inf', cutoff);
  },
};
