import { alertsQueue } from '../modules/alerts/alerts.queue.js';
import { alertsService } from '../modules/alerts/alerts.service.js';
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
  /** Адресат недостижим навсегда: чат не найден или бот заблокирован. */
  onPermanentFailure?: (telegramId: number, reason: string) => void;
}

/** Ошибка Bot API, после которой повтор бессмыслен. */
function isPermanentDeliveryFailure(err: unknown): boolean {
  const code = (err as { error_code?: number } | null)?.error_code;
  if (code === 403) return true; // бот заблокирован пользователем
  const description = String((err as { description?: string } | null)?.description ?? '');
  return code === 400 && /chat not found|user is deactivated/i.test(description);
}

function describeFailure(err: unknown): string {
  const e = err as { error_code?: number; description?: string } | null;
  return `${e?.error_code ?? '?'}: ${e?.description ?? 'неизвестная причина'}`;
}

export async function runAlertsWorker(options: WorkerOptions): Promise<number> {
  const {
    send,
    blockSeconds = 5,
    stopped = () => false,
    stopWhenEmpty = false,
    onError,
    onPermanentFailure,
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
      // Вечерний отчёт лежит в очереди без цифр: планировщик ставит его сильно
      // заранее, и посчитанные тогда суммы к моменту отправки уже неверны.
      const ready = await alertsService.hydrateAlert(alert);
      await send(ready.telegramId, renderAlert(ready));
      delivered += 1;
    } catch (err) {
      // Пуш не критичен: логируем и идём дальше, чтобы одна недоставка
      // не блокировала очередь остальным пользователям. Постоянные отказы
      // (чат не найден, бот заблокирован) — это не инцидент, а факт: пишем
      // строкой, а не стектрейсом, иначе журнал захлёбывается.
      if (isPermanentDeliveryFailure(err)) {
        onPermanentFailure?.(alert.telegramId, describeFailure(err));
      } else {
        onError?.(err);
      }
    }
  }

  return delivered;
}
