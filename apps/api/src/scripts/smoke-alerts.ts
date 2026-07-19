import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { rkey } from '../redis/keys.js';
import { periodOf } from '../shared/period.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { transactionsService } from '../modules/transactions/transactions.service.js';
import { alertsQueue } from '../modules/alerts/alerts.queue.js';
import { alertsService } from '../modules/alerts/alerts.service.js';
import { renderAlert } from '../bot/messages.js';
import { runAlertsWorker } from '../workers/alerts.worker.js';

/**
 * Проверка Фазы 6 без обращения к Telegram: триггеры кладут пуши в очередь,
 * воркер их забирает и отдаёт в подменный транспорт.
 * Запуск: npm run smoke:alerts --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_111;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

async function resetUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
  await pool.query('UPDATE wallets SET balance = 50000000 WHERE user_id = $1', [userId]);
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:user:${userId}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.del(rkey.botAlertsQueue, rkey.botAlertsScheduled);
}

async function main(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });
  await resetUser(user.id);

  const period = periodOf(new Date());
  const { rows: wallets } = await pool.query<{ id: string }>(
    'SELECT id FROM wallets WHERE user_id = $1 LIMIT 1',
    [user.id],
  );
  const { rows: cats } = await pool.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM categories c
      JOIN category_limits cl ON cl.category_id = c.id AND cl.period = $2
     WHERE c.user_id = $1 AND c.kind = 'expense' LIMIT 1`,
    [user.id, period],
  );
  const walletId = wallets[0]!.id;
  const category = cats[0]!;
  const { rows: limitRows } = await pool.query<{ limit_amount: string }>(
    'SELECT limit_amount FROM category_limits WHERE category_id = $1 AND period = $2',
    [category.id, period],
  );
  const limit = Number(limitRows[0]!.limit_amount);

  console.log('\n[1] Умеренная трата — пушей быть не должно');
  // Заметно ниже дневной нормы бюджета: ни лимит, ни темп не должны сработать.
  const smallSpend = Math.floor(limit / 100);
  await transactionsService.processDnd(user, {
    source: 'wallet',
    target: 'expense',
    walletId,
    categoryId: category.id,
    amount: smallSpend,
  });
  check('очередь пуста', (await alertsQueue.size()) === 0, await alertsQueue.size());

  console.log('\n[2] Достижение лимита категории');
  await transactionsService.processDnd(user, {
    source: 'wallet',
    target: 'expense',
    walletId,
    categoryId: category.id,
    amount: limit - smallSpend,
  });
  const afterLimit = await redis.lrange(rkey.botAlertsQueue, 0, -1);
  const kinds = afterLimit.map((p) => (JSON.parse(p) as { kind: string }).kind);
  check('поставлен пуш limit_reached', kinds.includes('limit_reached'), kinds);
  check('заодно сработал fast_pace', kinds.includes('fast_pace'), kinds);

  console.log('\n[3] Повтор не дублирует уведомление');
  const before = await alertsQueue.size();
  await transactionsService.processDnd(user, {
    source: 'wallet',
    target: 'expense',
    walletId,
    categoryId: category.id,
    amount: 1000,
  });
  const after = await alertsQueue.size();
  check('дедупликация сработала: overdraft добавлен один раз', after - before === 1, {
    before,
    after,
  });

  console.log('\n[4] Доставка воркером через подменный транспорт');
  const sent: Array<{ chatId: number; text: string }> = [];
  const delivered = await runAlertsWorker({
    send: async (chatId, text) => {
      sent.push({ chatId, text });
    },
    blockSeconds: 1,
    // Разовый прогон: выходим, как только очередь опустела.
    stopWhenEmpty: true,
  });
  check('пуши доставлены', delivered > 0, delivered);
  check(
    'адресат — telegram_id пользователя',
    sent.every((m) => m.chatId === TEST_TELEGRAM_ID),
    sent.map((m) => m.chatId),
  );
  check('очередь опустела', (await alertsQueue.size()) === 0);
  console.log('\n  Тексты уведомлений:\n');
  for (const m of sent) console.log(`  ${m.text.replace(/\n/g, '\n  ')}\n`);

  console.log('[5] Отложенные напоминания');
  await pool.query('DELETE FROM transactions WHERE user_id = $1', [user.id]);
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:user:${user.id}:alert:*`);
  if (keys.length > 0) await redis.del(...keys);
  const scheduled = await alertsService.scheduleEveningReminders();
  check('напоминание запланировано', scheduled > 0, scheduled);
  check('лежит в ZSET, а не в LIST', (await alertsQueue.size()) === 0);
  const repeat = await alertsService.scheduleEveningReminders();
  check('повторный вызов ничего не добавляет', repeat === 0, repeat);

  // Двигаем время вперёд: созревшее напоминание должно уехать в основную очередь.
  const promoted = await alertsQueue.promoteDue(new Date(Date.now() + 24 * 60 * 60 * 1000));
  check('созревшие переносятся в очередь доставки', promoted > 0, promoted);
  const payload = await redis.lrange(rkey.botAlertsQueue, 0, -1);
  const reminder = payload.map((p) => JSON.parse(p) as { kind: string })[0];
  check('это вечернее напоминание', reminder?.kind === 'evening_reminder', reminder);
  if (reminder) console.log(`\n  ${renderAlert(reminder as never).replace(/\n/g, '\n  ')}\n`);

  await redis.del(rkey.botAlertsQueue, rkey.botAlertsScheduled);
  console.log(failures === 0 ? '🎉 Все проверки пройдены' : `💥 Провалено: ${failures}`);
}

main()
  .catch((err) => {
    console.error('❌ Смоук упал:', err);
    failures += 1;
  })
  .finally(async () => {
    await pool.end();
    redis.disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
