import { Api } from 'grammy';
import { env } from '../config/env.js';

/**
 * Bot API как транспорт для процесса API: отправка документов и сообщений
 * без long polling. Сам polling живёт в отдельном процессе (`npm run bot`),
 * поэтому здесь создаётся только клиент — конфликта getUpdates не возникает.
 *
 * Клиент ленивый: тесты и скрипты, не трогающие Telegram, не создают его вовсе.
 */
let api: Api | null = null;

export function getBotApi(): Api {
  api ??= new Api(env.TELEGRAM_BOT_TOKEN);
  return api;
}

/** Подменить клиент в проверках, чтобы ничего не улетело в Telegram. */
export function setBotApi(custom: Api | null): void {
  api = custom;
}
