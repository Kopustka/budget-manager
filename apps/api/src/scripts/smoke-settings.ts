import { Api } from 'grammy';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { transactionsService } from '../modules/transactions/transactions.service.js';
import { settingsService } from '../modules/settings/settings.service.js';
import { exportService } from '../modules/export/export.service.js';
import { setBotApi } from '../bot/bot-api.js';
import {
  dayIndexInPeriod,
  daysInPeriod,
  periodOf,
  periodRange,
} from '../shared/period.js';

/**
 * Проверка настроек: сдвинутый день начала месяца, пересчёт валюты и CSV-выгрузка.
 * Telegram не трогаем — Bot API подменяется заглушкой.
 * Запуск: npm run smoke:settings --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_111;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, JSON.stringify(detail ?? ''));
  }
}

async function reset(userId: string): Promise<void> {
  await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
  // Валюту кошельков возвращаем вместе с балансом: пересчёт меняет и её, иначе
  // после прогона у пользователя-RUB остаются кошельки в USD.
  await pool.query(
    "UPDATE wallets SET balance = 100000000, currency = 'RUB' WHERE user_id = $1",
    [userId],
  );
  await pool.query("UPDATE users SET month_start_day = 1, currency = 'RUB' WHERE id = $1", [userId]);
  // Лимиты пересчёт тоже делит на курс, а обратного хода у него нет: без этого
  // прогон за прогоном они усыхают, и следующий smoke-dnd ловит овердрафт
  // с первого же списания. Возвращаем ровно сидовое состояние — лимит только
  // на «Продукты» (см. apps/api/src/db/seed.ts).
  await pool.query(
    `DELETE FROM category_limits
      WHERE category_id IN (
        SELECT id FROM categories WHERE user_id = $1 AND name <> 'Продукты'
      )`,
    [userId],
  );
  await pool.query(
    `UPDATE category_limits SET limit_amount = 2000000
      WHERE category_id IN (
        SELECT id FROM categories WHERE user_id = $1 AND name = 'Продукты'
      )`,
    [userId],
  );
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:user:${userId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function main(): Promise<void> {
  console.log('\n[1] Арифметика периода со сдвигом');
  // День начала 2: 1 июля принадлежит ещё июньскому периоду.
  check(
    '1 июля при дне начала 2 → период июня',
    periodOf(new Date('2026-07-01T10:00:00Z'), 2) === '2026-06',
    periodOf(new Date('2026-07-01T10:00:00Z'), 2),
  );
  check(
    '2 июля при дне начала 2 → период июля',
    periodOf(new Date('2026-07-02T10:00:00Z'), 2) === '2026-07',
    periodOf(new Date('2026-07-02T10:00:00Z'), 2),
  );
  const june = periodRange('2026-06', 2);
  check(
    'границы июньского периода — со 2 июня по 2 июля',
    june.start.toISOString().startsWith('2026-06-02') &&
      june.end.toISOString().startsWith('2026-07-02'),
    { start: june.start.toISOString(), end: june.end.toISOString() },
  );
  check('в феврале 2026 при дне 28 — 28 дней', daysInPeriod('2026-02', 28) === 28, daysInPeriod('2026-02', 28));
  check(
    'период через границу года считается',
    daysInPeriod('2026-12', 15) === 31,
    daysInPeriod('2026-12', 15),
  );
  check(
    'номер дня внутри периода',
    dayIndexInPeriod(new Date('2026-07-05T00:00:00Z'), '2026-07', 2) === 3,
    dayIndexInPeriod(new Date('2026-07-05T00:00:00Z'), '2026-07', 2),
  );

  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });
  await reset(user.id);

  const { rows: wallets } = await pool.query<{ id: string }>(
    'SELECT id FROM wallets WHERE user_id = $1 LIMIT 1',
    [user.id],
  );
  const { rows: cats } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE user_id = $1 AND kind = 'expense' LIMIT 1`,
    [user.id],
  );
  const walletId = wallets[0]!.id;
  const categoryId = cats[0]!.id;

  console.log('\n[2] Смена дня начала месяца');
  const before = settingsService.describe(user);
  check('по умолчанию месяц начинается 1-го', before.monthStartDay === 1, before);
  const after = await settingsService.setMonthStartDay(user, 2);
  check('день начала сохранён', after.monthStartDay === 2, after);
  check(
    'границы периода сдвинулись на 2-е число',
    after.periodStart.slice(8, 10) === '02',
    after,
  );
  const { rows: dbRows } = await pool.query<{ month_start_day: number }>(
    'SELECT month_start_day FROM users WHERE id = $1',
    [user.id],
  );
  check('значение записано в БД', dbRows[0]?.month_start_day === 2, dbRows[0]);

  console.log('\n[3] Трата попадает в период по новым границам');
  const shifted = { ...user, monthStartDay: 2 };
  // Операция 1-го числа текущего месяца должна лечь в ПРЕДЫДУЩИЙ период.
  const now = new Date();
  const firstOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0),
  ).toISOString();
  const opFirst = await transactionsService.processDnd(shifted, {
    source: 'wallet',
    target: 'expense',
    walletId,
    categoryId,
    amount: 30_000,
    occurredAt: firstOfMonth,
    comment: 'settings: 1-е число',
  });
  const currentPeriod = periodOf(now, 2);
  const spentCurrent = await redis.hget(
    `${env.REDIS_NAMESPACE}:user:${user.id}:spent:${currentPeriod}`,
    categoryId,
  );
  check(
    'трата 1-го числа не попала в текущий период',
    spentCurrent === null || Number(spentCurrent) === 0,
    { spentCurrent, currentPeriod },
  );
  check('операция всё же создана', Boolean(opFirst.transactionId));

  const opToday = await transactionsService.processDnd(shifted, {
    source: 'wallet',
    target: 'expense',
    walletId,
    categoryId,
    amount: 20_000,
    comment: 'settings: сегодня',
  });
  check(
    'сегодняшняя трата учтена в текущем периоде',
    opToday.categorySpent >= 20_000,
    opToday.categorySpent,
  );

  console.log('\n[4] Пересчёт валюты');
  const { rows: beforeSums } = await pool.query<{ balance: string; total: string }>(
    `SELECT (SELECT balance FROM wallets WHERE id = $1) AS balance,
            (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id = $2) AS total`,
    [walletId, user.id],
  );
  const rate = 0.5;
  const conversion = await settingsService.changeCurrency(shifted, { currency: 'USD', rate });
  const { rows: afterSums } = await pool.query<{ balance: string; total: string; currency: string }>(
    `SELECT (SELECT balance FROM wallets WHERE id = $1) AS balance,
            (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id = $2) AS total,
            (SELECT currency FROM users WHERE id = $2) AS currency`,
    [walletId, user.id],
  );
  check(
    'баланс умножен на курс',
    Number(afterSums[0]!.balance) === Math.round(Number(beforeSums[0]!.balance) * rate),
    { before: beforeSums[0]!.balance, after: afterSums[0]!.balance },
  );
  check(
    'суммы транзакций умножены на курс',
    Number(afterSums[0]!.total) === Math.round(Number(beforeSums[0]!.total) * rate),
    { before: beforeSums[0]!.total, after: afterSums[0]!.total },
  );
  check('валюта пользователя обновлена', afterSums[0]!.currency === 'USD', afterSums[0]);
  const { rows: log } = await pool.query<{ rate: string; to_currency: string }>(
    'SELECT rate, to_currency FROM currency_conversions WHERE user_id = $1 ORDER BY applied_at DESC LIMIT 1',
    [user.id],
  );
  check('пересчёт зафиксирован в журнале', Number(log[0]?.rate) === rate, log[0]);
  check('затронутые строки посчитаны', conversion.transactions >= 2, conversion);
  const cacheKeys = await redis.keys(`${env.REDIS_NAMESPACE}:user:${user.id}:spent:*`);
  check('кэш агрегатов сброшен', cacheKeys.length === 0, cacheKeys);

  console.log('\n[5] Выгрузка CSV');
  const usd = { ...shifted, currency: 'USD' };
  const exported = await exportService.build(usd);
  const text = exported.csv.toString('utf8');
  const lines = text.trim().split('\r\n');
  check('строк = заголовок + операции', lines.length === exported.rows + 1, {
    lines: lines.length,
    rows: exported.rows,
  });
  check('есть BOM для Excel', text.charCodeAt(0) === 0xfeff);
  check('заголовок на месте', lines[0]?.startsWith('Дата;Время;Тип') ?? false, lines[0]);
  check('валюта в строках — текущая', text.includes('"USD"'));
  check('имя файла говорящее', exported.fileName.endsWith('.csv'), exported.fileName);

  const rangeOnly = await exportService.build(usd, new Date(Date.now() + 86_400_000).toISOString());
  check('фильтр по дате отсекает операции', rangeOnly.rows === 0, rangeOnly.rows);

  console.log('\n[6] Отправка файла в чат (транспорт застаблен)');
  const sent: Array<{ method: string; chatId: unknown }> = [];
  const stub = new Api('0:stub');
  stub.config.use((_prev, method, payload) => {
    sent.push({ method, chatId: (payload as { chat_id?: unknown }).chat_id });
    return Promise.resolve({ ok: true, result: {} } as never);
  });
  setBotApi(stub);
  const { getBotApi } = await import('../bot/bot-api.js');
  await getBotApi().sendDocument(user.telegramId, {
    filename: exported.fileName,
    // Минимальный InputFile-совместимый объект не нужен: трансформер перехватит вызов раньше.
  } as never);
  check('вызван sendDocument', sent[0]?.method === 'sendDocument', sent[0]);
  check('адресат — telegram_id пользователя', sent[0]?.chatId === TEST_TELEGRAM_ID, sent[0]);
  setBotApi(null);

  // Возвращаем тестового пользователя в исходное состояние.
  await reset(user.id);
  console.log(failures === 0 ? '\n🎉 Все проверки пройдены' : `\n💥 Провалено: ${failures}`);
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
