import { createBot, telegramSender } from '../bot/bot.js';
import { alertsService } from '../modules/alerts/alerts.service.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { rkey } from '../redis/keys.js';
import { runAlertsWorker } from './alerts.worker.js';

/**
 * Процесс воркеров: доставка пушей + планировщик вечерних отчётов.
 * Запуск: npm run worker --workspace apps/api
 *
 * Бот здесь используется только как транспорт (updates не читаются) —
 * long polling живёт в отдельном процессе `npm run bot`, иначе два процесса
 * дрались бы за один getUpdates.
 */
const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

let stopping = false;

async function main(): Promise<void> {
  const bot = createBot();
  const send = telegramSender(bot);

  const scheduler = setInterval(() => {
    void alertsService.scheduleDailyDigests().then(
      (count: number) => {
        if (count > 0) console.log(`Запланировано отчётов: ${count}`);
      },
      (err: unknown) => console.error('Планировщик:', err),
    );
  }, SCHEDULER_INTERVAL_MS);

  // Первый прогон сразу, не дожидаясь интервала.
  await alertsService.scheduleDailyDigests().then(
    (count: number) => console.log(`Планировщик: отчётов на сегодня — ${count}`),
    (err: unknown) => console.error('Планировщик:', err),
  );

  console.log(`Воркер запущен: слушаю ${rkey.botAlertsQueue}`);
  const delivered = await runAlertsWorker({
    send,
    stopped: () => stopping,
    onError: (err) => console.error('Воркер:', err),
    onPermanentFailure: (telegramId, reason) =>
      console.warn(`Пуш не доставлен (${telegramId}): ${reason}`),
  });

  clearInterval(scheduler);
  console.log(`Остановлен. Доставлено уведомлений: ${delivered}`);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Получен ${signal}, останавливаюсь...`);
  stopping = true;
  // Даём текущему BRPOP дожить свой таймаут, потом закрываем соединения.
  setTimeout(() => {
    void pool.end();
    redis.disconnect();
    process.exit(0);
  }, 6000);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err: unknown) => {
  console.error('Воркер упал:', err);
  process.exit(1);
});
