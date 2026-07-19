import { createHmac } from 'node:crypto';
import { CATEGORY_COLORS, MAX_WALLETS } from '@budget/shared';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';

/**
 * Создание кошельков, категорий расходов и источников дохода через HTTP.
 * Требует запущенный API (`npm run dev:api`).
 * Запуск: npm run smoke:crud --workspace apps/api
 */

const BASE = `http://127.0.0.1:${env.API_PORT}`;
const TEST_TELEGRAM_ID = 111_111_111;
/** Префикс имён — по нему же убираем за собой созданное. */
const PREFIX = 'smoke-crud';

function makeInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'smoke-crud',
    user: JSON.stringify({ id: TEST_TELEGRAM_ID, username: 'test_user', first_name: 'Тест' }),
  });
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const AUTH = `tma ${makeInitData()}`;

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers:
      body === undefined
        ? { Authorization: AUTH }
        : { Authorization: AUTH, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as T };
}

/** Форма ошибки API: текст лежит внутри `error`, а не в корне ответа. */
interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, JSON.stringify(detail ?? ''));
  }
}

/**
 * Сносим всё, что создали прошлые прогоны: иначе второй запуск упрётся в дубликаты.
 *
 * Заодно убираем сущности браузерного прогона (`e2e %`): у него нет доступа к
 * базе, а созданные им кошельки копятся до потолка в 12 штук.
 */
async function cleanup(userId: string): Promise<void> {
  const patterns = [`${PREFIX}%`, 'e2e %'];
  await pool.query(
    `DELETE FROM transactions WHERE user_id = $1
       AND category_id IN (SELECT id FROM categories WHERE user_id = $1 AND name LIKE ANY($2))`,
    [userId, patterns],
  );
  await pool.query(
    `DELETE FROM transactions WHERE user_id = $1
       AND wallet_id IN (SELECT id FROM wallets WHERE user_id = $1 AND name LIKE ANY($2))`,
    [userId, patterns],
  );
  await pool.query('DELETE FROM categories WHERE user_id = $1 AND name LIKE ANY($2)', [
    userId,
    patterns,
  ]);
  await pool.query('DELETE FROM wallets WHERE user_id = $1 AND name LIKE ANY($2)', [
    userId,
    patterns,
  ]);
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:user:${userId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function main(): Promise<void> {
  const me = await api<{ id: string }>('GET', '/api/me');
  if (me.status !== 200) throw new Error('API недоступен или initData не принят');
  const userId = me.data.id;
  await cleanup(userId);

  console.log('\n[1] Создание кошелька');
  const wallet = await api<{ id: string; name: string; balance: number; currency: string }>(
    'POST',
    '/api/wallets',
    { name: `${PREFIX} Карта`, balance: 150_000 },
  );
  check('кошелёк создан (201)', wallet.status === 201, wallet.data);
  check('стартовый баланс сохранён', wallet.data?.balance === 150_000, wallet.data);
  check('валюта унаследована от пользователя', typeof wallet.data?.currency === 'string', wallet.data);

  const walletList = await api<{ items: Array<{ id: string }> }>('GET', '/api/wallets');
  check(
    'кошелёк виден в списке',
    walletList.data.items.some((w) => w.id === wallet.data.id),
  );

  console.log('\n[2] Защита от дублей и мусорного ввода');
  const dup = await api<ApiErrorBody>('POST', '/api/wallets', {
    // Регистр другой — для человека это то же самое название.
    name: `${PREFIX} КАРТА`,
    balance: 0,
  });
  check('дубликат имени отклонён (409)', dup.status === 409, dup);
  check('в ответе объяснение, а не код БД', /назван/i.test(dup.data?.error?.message ?? ''), dup.data);

  const empty = await api('POST', '/api/wallets', { name: '   ' });
  check('пустое имя отклонено', empty.status === 422, empty);

  const badIcon = await api('POST', '/api/categories', {
    name: `${PREFIX} Мусор`,
    kind: 'expense',
    icon: 'not-a-real-icon',
  });
  check('иконка вне каталога отклонена', badIcon.status === 422, badIcon);

  console.log('\n[3] Категория расхода');
  const expense = await api<{ id: string; color: string; spent: number; limit: number | null }>(
    'POST',
    '/api/categories',
    { name: `${PREFIX} Спорт`, kind: 'expense', icon: 'dumbbell' },
  );
  check('категория создана (201)', expense.status === 201, expense.data);
  check(
    'цвет подставлен из палитры',
    CATEGORY_COLORS.includes(expense.data?.color as (typeof CATEGORY_COLORS)[number]),
    expense.data?.color,
  );
  check('статистика инициализирована нулём', expense.data?.spent === 0, expense.data);

  const categories = await api<{ items: Array<{ id: string; kind: string; spent: number | null }> }>(
    'GET',
    '/api/categories',
  );
  const listed = categories.data.items.find((c) => c.id === expense.data.id);
  check('категория попала в матрицу', listed?.kind === 'expense', listed);

  console.log('\n[4] Новая категория работает как настоящая');
  const spend = await api<{ categorySpent: number }>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'expense',
    walletId: wallet.data.id,
    categoryId: expense.data.id,
    amount: 25_000,
    comment: `${PREFIX} тестовая трата`,
  });
  check('трата в новую категорию прошла', spend.status === 201, spend.data);
  check('spent пересчитан', spend.data?.categorySpent === 25_000, spend.data);

  const walletsAfter = await api<{ items: Array<{ id: string; balance: number }> }>(
    'GET',
    '/api/wallets',
  );
  const balanceAfter = walletsAfter.data.items.find((w) => w.id === wallet.data.id)?.balance;
  check('баланс нового кошелька уменьшился', balanceAfter === 125_000, balanceAfter);

  const distribution = await api<{ items: Array<{ categoryId: string; spent: number }> }>(
    'GET',
    '/api/analytics/distribution',
  );
  check(
    'категория видна в аналитике',
    distribution.data.items.some((i) => i.categoryId === expense.data.id && i.spent === 25_000),
    distribution.data.items.find((i) => i.categoryId === expense.data.id),
  );

  console.log('\n[5] Источник дохода');
  const income = await api<{ id: string; kind: string; spent: number | null }>(
    'POST',
    '/api/categories',
    { name: `${PREFIX} Спорт`, kind: 'income', icon: 'banknote' },
  );
  // Имя то же, что у расходной: это разные половины матрицы, конфликта нет.
  check('одноимённый источник дохода разрешён', income.status === 201, income.data);
  check('вид сохранён', income.data?.kind === 'income', income.data);
  check('у дохода нет статистики трат', income.data?.spent === null, income.data);

  const dupIncome = await api('POST', '/api/categories', {
    name: `${PREFIX} Спорт`,
    kind: 'income',
  });
  check('дубликат внутри вида отклонён (409)', dupIncome.status === 409, dupIncome);

  console.log('\n[6] Потолок количества');
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*) FROM wallets WHERE user_id = $1',
    [userId],
  );
  const existing = Number(rows[0]!.count);
  const room = MAX_WALLETS - existing;
  for (let i = 0; i < room; i++) {
    await api('POST', '/api/wallets', { name: `${PREFIX} Запас ${i}`, balance: 0 });
  }
  const overflow = await api<ApiErrorBody>('POST', '/api/wallets', {
    name: `${PREFIX} Лишний`,
    balance: 0,
  });
  check('за потолком кошельков — 409', overflow.status === 409, overflow);
  check(
    'в тексте назван предел',
    (overflow.data?.error?.message ?? '').includes(String(MAX_WALLETS)),
    overflow.data,
  );

  await cleanup(userId);
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
