import { Bot, InlineKeyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { env } from '../config/env.js';

/**
 * Telegram-бот: точка входа в Mini App и канал уведомлений.
 *
 * Кнопка `web_app` требует https-адрес — Telegram отклоняет http даже на
 * localhost. Поэтому при не-https WEB_APP_URL кнопку не показываем и честно
 * объясняем это в чате, вместо того чтобы ловить ошибку от Bot API.
 */
export interface BotOptions {
  /** Переопределение адреса Mini App (проверки, staging). */
  webAppUrl?: string;
  /** Данные бота: если переданы, grammY не ходит в getMe при инициализации. */
  botInfo?: UserFromGetMe;
}

export function createBot(options: BotOptions = {}): Bot {
  const webAppUrl = options.webAppUrl ?? env.WEB_APP_URL;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, options.botInfo ? { botInfo: options.botInfo } : {});
  const canOpenApp = webAppUrl.startsWith('https://');

  const keyboard = canOpenApp
    ? new InlineKeyboard().webApp('💸 Открыть приложение', webAppUrl)
    : undefined;

  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '<b>Budget Manager</b> — учёт денег перетаскиванием.',
        '',
        'Перетащите доход в кошелёк, чтобы зачислить, и кошелёк в категорию — чтобы списать.',
        'Я пришлю уведомление, когда лимит категории будет исчерпан или траты пойдут слишком быстро.',
        canOpenApp ? '' : '\n⚠️ Приложение пока не опубликовано по https, кнопка появится после публикации.',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '/start — открыть приложение',
        '/help — эта справка',
        '',
        'Уведомления приходят автоматически: исчерпан лимит, перерасход,',
        'слишком быстрые траты за день и вечернее напоминание записать расходы.',
      ].join('\n'),
      { reply_markup: keyboard },
    );
  });

  bot.catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Ошибка бота:', err.message);
  });

  return bot;
}

/** Транспорт отправки — отделён от воркера, чтобы его можно было подменить в тестах. */
export type SendMessage = (chatId: number, text: string) => Promise<void>;

export function telegramSender(bot: Bot): SendMessage {
  return async (chatId, text) => {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  };
}
