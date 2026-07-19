import type { Update } from 'grammy/types';
import { createBot } from '../bot/bot.js';

/**
 * Проверка диалога бота без обращения к Telegram: исходящие вызовы Bot API
 * перехватываются трансформером, апдейты подаются напрямую в handleUpdate.
 * Запуск: npm run smoke:bot --workspace apps/api
 */

const BOT_INFO = {
  id: 1,
  is_bot: true as const,
  first_name: 'Budget Manager',
  username: 'bugetmanagementbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, JSON.stringify(detail ?? ''));
  }
}

interface Captured {
  method: string;
  payload: Record<string, unknown>;
}

/** Собрать бота, чей Bot API никуда не ходит, а только записывает вызовы. */
async function buildBot(webAppUrl: string): Promise<{ bot: ReturnType<typeof createBot>; calls: Captured[] }> {
  const calls: Captured[] = [];
  const bot = createBot({ webAppUrl, botInfo: BOT_INFO });
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  await bot.init();
  return { bot, calls };
}

function commandUpdate(text: string): Update {
  return {
    update_id: Math.floor(Math.random() * 1e6),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 111_111_111, type: 'private', first_name: 'Тест' },
      from: { id: 111_111_111, is_bot: false, first_name: 'Тест' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.length }],
    },
  } as Update;
}

async function main(): Promise<void> {
  console.log('\n[1] /start с опубликованным https-адресом');
  const https = await buildBot('https://app.example.com');
  await https.bot.handleUpdate(commandUpdate('/start'));
  const reply = https.calls.find((c) => c.method === 'sendMessage');
  check('бот ответил на /start', Boolean(reply));
  const markup = reply?.payload.reply_markup as
    | { inline_keyboard: Array<Array<{ text: string; web_app?: { url: string } }>> }
    | undefined;
  const button = markup?.inline_keyboard?.[0]?.[0];
  check('есть кнопка web_app', Boolean(button?.web_app), button);
  check('кнопка ведёт на адрес Mini App', button?.web_app?.url === 'https://app.example.com', button);

  console.log('\n[2] /start без https — кнопки быть не должно');
  const local = await buildBot('http://localhost:5173');
  await local.bot.handleUpdate(commandUpdate('/start'));
  const localReply = local.calls.find((c) => c.method === 'sendMessage');
  check('кнопка не отправлена', localReply?.payload.reply_markup === undefined);
  check(
    'причина объяснена в тексте',
    String(localReply?.payload.text ?? '').includes('https'),
    localReply?.payload.text,
  );

  console.log('\n[3] /help');
  await https.bot.handleUpdate(commandUpdate('/help'));
  const help = https.calls.filter((c) => c.method === 'sendMessage').at(-1);
  check('справка отправлена', String(help?.payload.text ?? '').includes('/start'));

  console.log(failures === 0 ? '\n🎉 Все проверки пройдены' : `\n💥 Провалено: ${failures}`);
}

main()
  .catch((err) => {
    console.error('❌ Смоук упал:', err);
    failures += 1;
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));
