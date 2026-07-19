/**
 * Схема ключей Redis (из PRD). Единая точка формирования, чтобы не рассинхронить.
 * Префикс finapp: — namespace приложения.
 */
export const rkey = {
  /** ZSET: скользящее окно истории (30 дней) для карусели. score = occurredAt (unix) */
  txCache30d: (userId: string) => `finapp:user:${userId}:tx_cache:30d`,

  /** HASH: текущие балансы кошельков. field = walletId, value = баланс (минорные) */
  wallets: (userId: string) => `finapp:user:${userId}:wallets`,

  /** HASH: накопленные траты по категориям за месяц. field = categoryId, value = spent */
  spent: (userId: string, period: string) =>
    `finapp:user:${userId}:spent:${period}`,

  /** HASH: лимиты по категориям за месяц. field = categoryId, value = limit */
  limits: (userId: string, period: string) =>
    `finapp:user:${userId}:limits:${period}`,

  /** LIST: очередь моментальных пушей боту (FIFO) */
  botAlertsQueue: 'finapp:queue:bot_alerts',

  /** ZSET: очередь отложенных пушей. score = timestamp отправки */
  botAlertsScheduled: 'finapp:queue:bot_alerts:scheduled',

  /**
   * Ключ-дедупликатор пуша: пока он жив, повторный алерт того же вида
   * не ставится в очередь. Без него достижение лимита слало бы уведомление
   * на каждую следующую трату по категории.
   */
  alertOnce: (userId: string, kind: string, scope: string) =>
    `finapp:user:${userId}:alert:${kind}:${scope}`,
} as const;

/** Текущий период в формате YYYY-MM (UTC). */
export function currentPeriod(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
