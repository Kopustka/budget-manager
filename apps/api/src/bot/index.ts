import { createBot } from './bot.js';

/**
 * Long polling бота: отдельный процесс (`npm run bot --workspace apps/api`).
 * Уведомления шлёт воркер — здесь только диалог с пользователем.
 */
const bot = createBot();

process.on('SIGINT', () => void bot.stop());
process.on('SIGTERM', () => void bot.stop());

bot.start({
  onStart: (info) => {
    // eslint-disable-next-line no-console
    console.log(`Бот @${info.username} запущен (long polling)`);
  },
});
