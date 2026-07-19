import { alertsQueue } from '../modules/alerts/alerts.queue.js';
import { renderAlert } from '../bot/messages.js';
import type { SendMessage } from '../bot/bot.js';

/**
 * Потребитель очереди пушей.
 *
 * Транспорт передаётся снаружи: в бою это Bot API, в проверках — заглушка,
 * поэтому логику доставки можно гонять, не трогая реальный Telegram.
 */
export interface WorkerOptions {
  send: SendMessage;
  /** Сколько ждать сообщение за одну итерацию (сек). */
  blockSeconds?: number;
  /** Остановиться, когда вернёт true (для graceful shutdown). */
  stopped?: () => boolean;
  /** Разовый прогон: выйти, как только очередь опустела (проверки, ручной дренаж). */
  stopWhenEmpty?: boolean;
  onError?: (err: unknown) => void;
}

export async function runAlertsWorker(options: WorkerOptions): Promise<number> {
  const {
    send,
    blockSeconds = 5,
    stopped = () => false,
    stopWhenEmpty = false,
    onError,
  } = options;
  let delivered = 0;

  while (!stopped()) {
    // Сначала переносим созревшие отложенные — у воркера одна точка приёма.
    await alertsQueue.promoteDue().catch(onError);

    const alert = await alertsQueue.pop(blockSeconds).catch((err) => {
      onError?.(err);
      return null;
    });
    if (!alert) {
      if (stopWhenEmpty) break;
      continue;
    }

    try {
      await send(alert.telegramId, renderAlert(alert));
      delivered += 1;
    } catch (err) {
      // Пуш не критичен: логируем и идём дальше, чтобы одна недоставка
      // не блокировала очередь остальным пользователям.
      onError?.(err);
    }
  }

  return delivered;
}
