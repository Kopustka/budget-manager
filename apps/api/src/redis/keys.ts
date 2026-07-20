import { env } from '../config/env.js';

/**
 * Схема ключей Redis (из PRD). Единая точка формирования, чтобы не рассинхронить.
 * Namespace задаётся через REDIS_NAMESPACE (по умолчанию finapp), чтобы прод
 * и проверки могли жить на одном Redis, не воруя друг у друга сообщения.
 */
const NS = env.REDIS_NAMESPACE;

export const rkey = {
  /** ZSET: скользящее окно истории (30 дней) для карусели. score = occurredAt (unix) */
  txCache30d: (profileId: string) => `${NS}:profile:${profileId}:tx_cache:30d`,

  /** HASH: текущие балансы кошельков. field = walletId, value = баланс (минорные) */
  wallets: (profileId: string) => `${NS}:profile:${profileId}:wallets`,

  /** HASH: накопленные траты по категориям за месяц. field = categoryId, value = spent */
  spent: (profileId: string, period: string) =>
    `${NS}:profile:${profileId}:spent:${period}`,

  /** HASH: лимиты по категориям за месяц. field = categoryId, value = limit */
  limits: (profileId: string, period: string) =>
    `${NS}:profile:${profileId}:limits:${period}`,

  /**
   * ZSET: ближайшие неоплаченные события календаря. score = дата списания (unix).
   * Нужен, чтобы карусель на старте Mini App не ходила за ними в PostgreSQL.
   */
  planned: (profileId: string) => `${NS}:profile:${profileId}:planned:30d`,

  /** LIST: очередь моментальных пушей боту (FIFO) */
  botAlertsQueue: `${NS}:queue:bot_alerts`,

  /** ZSET: очередь отложенных пушей. score = timestamp отправки */
  botAlertsScheduled: `${NS}:queue:bot_alerts:scheduled`,

  /**
   * Ключ-дедупликатор пуша: пока он жив, повторный алерт того же вида
   * не ставится в очередь. Без него достижение лимита слало бы уведомление
   * на каждую следующую трату по категории.
   */
  alertOnce: (profileId: string, kind: string, scope: string) =>
    `${NS}:profile:${profileId}:alert:${kind}:${scope}`,
} as const;
