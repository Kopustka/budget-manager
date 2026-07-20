import { limitStatus } from '@budget/shared';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { rkey } from '../redis/keys.js';
import { periodOf } from '../shared/period.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { profilesRepository } from '../modules/profiles/profiles.repository.js';
import { categoriesRepository } from '../modules/categories/categories.repository.js';
import { transactionsService } from '../modules/transactions/transactions.service.js';
import { cache } from '../redis/cache.js';
import type { BotAlert } from '../modules/alerts/alerts.types.js';

/**
 * Проверка модуля планирования расходов: upsert лимита, пороги статусов и
 * атомарная проверка при списании (spent → сравнение → очередь бота).
 *
 * Запуск: npm run smoke:limits --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_222;

/** Лимит на период: 10 000 в минорных единицах. */
const LIMIT = 1_000_000;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

async function queueKinds(): Promise<string[]> {
  const raw = await redis.lrange(rkey.botAlertsQueue, 0, -1);
  return raw.map((p) => (JSON.parse(p) as BotAlert).kind);
}

/**
 * Только уведомления о лимите. Рядом в очереди живёт fast_pace — независимый
 * триггер темпа трат: он законно срабатывает, когда месячный бюджет уходит за
 * день, и к проверке лимита отношения не имеет.
 */
async function limitAlerts(): Promise<string[]> {
  const kinds = await queueKinds();
  return kinds.filter((k) => k === 'limit_reached' || k === 'overdraft');
}

async function main(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });
  const profile = await profilesRepository.findActiveScope(user.id);
  if (!profile) throw new Error('У тестового пользователя нет активного профиля');
  const period = periodOf(new Date(), profile.monthStartDay);

  // Чистый лист: остатки прошлого прогона исказили бы и spent, и дедупликацию.
  await pool.query('DELETE FROM transactions WHERE profile_id = $1', [profile.id]);
  await pool.query('UPDATE wallets SET balance = 50000000 WHERE profile_id = $1', [profile.id]);
  const stale = await redis.keys(`${env.REDIS_NAMESPACE}:profile:${profile.id}:*`);
  if (stale.length > 0) await redis.del(...stale);
  await redis.del(rkey.botAlertsQueue);

  const { rows: wallets } = await pool.query<{ id: string }>(
    'SELECT id FROM wallets WHERE profile_id = $1 LIMIT 1',
    [profile.id],
  );
  const { rows: cats } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE profile_id = $1 AND kind = 'expense' LIMIT 1`,
    [profile.id],
  );
  const walletId = wallets[0]!.id;
  const category = cats[0]!;

  const spend = (amount: number) =>
    transactionsService.processDnd(profile, {
      source: 'wallet',
      target: 'expense',
      walletId,
      categoryId: category.id,
      amount,
    });

  console.log('\n[1] Upsert лимита: повторная установка не плодит строк');
  await categoriesRepository.setLimit(category.id, period, LIMIT / 2);
  await categoriesRepository.setLimit(category.id, period, LIMIT);
  const { rows: limitRows } = await pool.query<{ limit_amount: string }>(
    'SELECT limit_amount FROM category_limits WHERE category_id = $1 AND period = $2',
    [category.id, period],
  );
  check('строка одна', limitRows.length === 1, limitRows.length);
  check('сумма обновлена', Number(limitRows[0]?.limit_amount) === LIMIT, limitRows[0]);

  // Лимит в быстрый слой пишет контроллер; здесь дублируем этот шаг вручную,
  // потому что дёргаем репозиторий напрямую, в обход HTTP.
  cache.setLimit(profile.id, period, category.id, LIMIT);

  console.log('\n[2] Трата до 85% — статус SAFE, очередь пуста');
  await spend(LIMIT * 0.5);
  check('статус SAFE', limitStatus(LIMIT * 0.5, LIMIT) === 'SAFE');
  check('пушей о лимите нет', (await limitAlerts()).length === 0, await queueKinds());

  console.log('\n[3] Пограничная зона 85–99% — WARNING, но пуша всё ещё нет');
  await spend(LIMIT * 0.4);
  const spent90 = await cache.getSpent(profile.id, period, category.id);
  check('spent в Redis верен', spent90 === LIMIT * 0.9, spent90);
  check('статус WARNING', limitStatus(spent90, LIMIT) === 'WARNING');
  // Порог 85% красит карточку, но не будит бота: уведомление только при 100%.
  check('пушей о лимите нет', (await limitAlerts()).length === 0, await queueKinds());

  console.log('\n[4] Ровно 100% — EXCEEDED и пуш limit_reached');
  await spend(LIMIT * 0.1);
  const spentFull = await cache.getSpent(profile.id, period, category.id);
  check('spent равен лимиту', spentFull === LIMIT, spentFull);
  check('статус EXCEEDED', limitStatus(spentFull, LIMIT) === 'EXCEEDED');
  check(
    'в очереди limit_reached',
    (await limitAlerts()).includes('limit_reached'),
    await queueKinds(),
  );

  console.log('\n[5] Превышение — пуш overdraft');
  await spend(LIMIT * 0.2);
  check('в очереди overdraft', (await limitAlerts()).includes('overdraft'), await queueKinds());
  const overdraftPayload = (await redis.lrange(rkey.botAlertsQueue, 0, -1))
    .map((p) => JSON.parse(p) as BotAlert)
    .find((a) => a.kind === 'overdraft');
  // Лимит в текст пуша подставляет Lua-скрипт — плейсхолдер -1 остаться не должен.
  check(
    'в payload настоящая сумма лимита',
    overdraftPayload?.kind === 'overdraft' && overdraftPayload.limit === LIMIT,
    overdraftPayload,
  );

  console.log('\n[6] Дедупликация: вторая трата поверх лимита не шлёт второй overdraft');
  const before = (await limitAlerts()).filter((k) => k === 'overdraft').length;
  await spend(LIMIT * 0.1);
  const after = (await limitAlerts()).filter((k) => k === 'overdraft').length;
  check('overdraft по-прежнему один', before === after && after === 1, { before, after });

  console.log('\n[7] Снятие лимита убирает его и из быстрого слоя');
  await categoriesRepository.removeLimit(category.id, period);
  cache.clearLimit(profile.id, period, category.id);
  const clearedLimit = await cache.getLimit(profile.id, period, category.id);
  check('лимита в Redis нет', clearedLimit === null, clearedLimit);
  check('статус NONE', limitStatus(spentFull, null) === 'NONE');

  console.log(
    failures === 0 ? '\n✅ Планирование расходов: все проверки пройдены' : `\n❌ Провалов: ${failures}`,
  );
  await redis.quit();
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
