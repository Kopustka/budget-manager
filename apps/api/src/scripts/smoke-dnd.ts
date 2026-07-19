import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { rkey, currentPeriod } from '../redis/keys.js';

/**
 * Сквозная проверка Фазы 2: DnD-сценарий через реальный HTTP + сверка PG↔Redis.
 * Требует запущенный API (`npm run dev --workspace apps/api`) и применённый сид.
 * Запуск: npm run smoke --workspace apps/api
 */

const BASE = `http://127.0.0.1:${env.API_PORT}`;
const TEST_TELEGRAM_ID = 111_111_111;

/** Собрать валидный initData, подписанный тем же ботовым токеном, что и проверяет API. */
function makeInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'smoke',
    user: JSON.stringify({
      id: TEST_TELEGRAM_ID,
      username: 'test_user',
      first_name: 'Тест',
    }),
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

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

/**
 * Прогон должен быть детерминированным, поэтому начинаем с чистого листа:
 * сносим транзакции тестового юзера, возвращаем сидовый баланс и чистим его Redis-ключи.
 * Затрагивает ТОЛЬКО пользователя с TEST_TELEGRAM_ID.
 */
async function resetTestUser(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE telegram_id = $1',
    [TEST_TELEGRAM_ID],
  );
  const userId = rows[0]?.id;
  if (!userId) return;
  await pool.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
  await pool.query('UPDATE wallets SET balance = 10000000 WHERE user_id = $1', [userId]);
  const keys = await redis.keys(`finapp:user:${userId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function main(): Promise<void> {
  const period = currentPeriod();
  await resetTestUser();

  console.log('\n[1] Здоровье и профиль');
  const health = await api('GET', '/health');
  check('/health = 200', health.status === 200, health.data);
  const me = await api<{ id: string; telegramId: number }>('GET', '/api/me');
  check('/api/me авторизован по initData', me.status === 200, me.data);
  const userId = me.data.id;

  const noAuth = await fetch(`${BASE}/api/me`);
  check('без initData — 401', noAuth.status === 401);

  console.log('\n[2] Справочники');
  const wallets = await api<{ items: Array<{ id: string; balance: number }> }>(
    'GET',
    '/api/wallets',
  );
  const categories = await api<{
    items: Array<{ id: string; kind: string; name: string; limit: number | null }>;
  }>('GET', '/api/categories');
  const wallet = wallets.data.items[0]!;
  const income = categories.data.items.find((c) => c.kind === 'income')!;
  const limited = categories.data.items.find((c) => c.kind === 'expense' && c.limit !== null)!;
  const plain = categories.data.items.find((c) => c.kind === 'expense' && c.limit === null)!;
  check('есть кошелёк, доход и расходные категории', !!wallet && !!income && !!limited && !!plain);
  const startBalance = wallet.balance;

  console.log('\n[3] Матрица: Доход → Расход запрещён');
  const forbidden = await api('POST', '/api/dnd', {
    source: 'income',
    target: 'expense',
    walletId: wallet.id,
    categoryId: plain.id,
    amount: 1000,
  });
  check('Доход→Расход = 403', forbidden.status === 403, forbidden.data);

  console.log('\n[4] Зачисление: Доход → Кошелёк');
  const deposit = await api<{ transactionId: string; walletBalance: number }>('POST', '/api/dnd', {
    source: 'income',
    target: 'wallet',
    walletId: wallet.id,
    categoryId: income.id,
    amount: 500_000,
    comment: 'smoke: зарплата',
  });
  check('зачисление = 201', deposit.status === 201, deposit.data);
  check(
    'баланс вырос на 500000',
    deposit.data.walletBalance === startBalance + 500_000,
    deposit.data,
  );

  console.log('\n[5] Списание в пределах лимита');
  const spend = await api<{
    transactionId: string;
    walletBalance: number;
    categorySpent: number;
    isOverdraft: boolean;
  }>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'expense',
    walletId: wallet.id,
    categoryId: limited.id,
    amount: 100_000,
    subcategory: 'молочка',
    comment: 'smoke: продукты',
  });
  check('списание = 201', spend.status === 201, spend.data);
  check(
    'баланс уменьшился на 100000',
    spend.data.walletBalance === deposit.data.walletBalance - 100_000,
    spend.data,
  );
  check('овердрафта нет', spend.data.isOverdraft === false, spend.data);

  console.log('\n[6] Сверка PG ↔ Redis');
  const { rows: pgWallet } = await pool.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE id = $1',
    [wallet.id],
  );
  const redisBalance = await redis.hget(rkey.wallets(userId), wallet.id);
  check(
    'баланс: PG = Redis = ответ API',
    Number(pgWallet[0]!.balance) === Number(redisBalance) &&
      Number(redisBalance) === spend.data.walletBalance,
    { pg: pgWallet[0]!.balance, redis: redisBalance, api: spend.data.walletBalance },
  );
  const redisSpent = await redis.hget(rkey.spent(userId, period), limited.id);
  check('spent: Redis = ответ API', Number(redisSpent) === spend.data.categorySpent, {
    redis: redisSpent,
    api: spend.data.categorySpent,
  });

  console.log('\n[7] Овердрафт по лимиту категории');
  const overLimit = (limited.limit ?? 0) + 100_000 - spend.data.categorySpent;
  const overdraft = await api<{ isOverdraft: boolean; categorySpent: number }>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'expense',
    walletId: wallet.id,
    categoryId: limited.id,
    amount: Math.max(overLimit, 1),
    comment: 'smoke: перебор лимита',
  });
  check('флаг овердрафта поднят', overdraft.data.isOverdraft === true, overdraft.data);

  console.log('\n[8] Откат транзакции при ошибке (недостаточно средств)');
  const { rows: beforeRows } = await pool.query<{ balance: string; cnt: string }>(
    `SELECT (SELECT balance FROM wallets WHERE id = $1) AS balance,
            (SELECT count(*) FROM transactions WHERE user_id = $2) AS cnt`,
    [wallet.id, userId],
  );
  const tooBig = await api('POST', '/api/dnd', {
    source: 'wallet',
    target: 'expense',
    walletId: wallet.id,
    categoryId: plain.id,
    amount: 999_999_999_9,
    comment: 'smoke: не должно пройти',
  });
  const { rows: afterRows } = await pool.query<{ balance: string; cnt: string }>(
    `SELECT (SELECT balance FROM wallets WHERE id = $1) AS balance,
            (SELECT count(*) FROM transactions WHERE user_id = $2) AS cnt`,
    [wallet.id, userId],
  );
  check('перерасход отклонён (409)', tooBig.status === 409, tooBig.data);
  check(
    'полный откат: баланс и число транзакций не изменились',
    beforeRows[0]!.balance === afterRows[0]!.balance && beforeRows[0]!.cnt === afterRows[0]!.cnt,
    { before: beforeRows[0], after: afterRows[0] },
  );

  console.log('\n[9] Правка транзакции');
  // Списание было на 100000 → уменьшаем до 50000, кошелёк должен получить +50000 назад.
  const balanceBeforeEdit = Number(afterRows[0]!.balance);
  const edited = await api<{ walletBalance: number; categorySpent: number }>(
    'PATCH',
    `/api/transactions/${spend.data.transactionId}`,
    { amount: 50_000, comment: 'smoke: исправлено' },
  );
  check('правка = 200', edited.status === 200, edited.data);
  check(
    'баланс скорректирован на +50000 (было списано 100000, стало 50000)',
    edited.data.walletBalance === balanceBeforeEdit + 50_000,
    { before: balanceBeforeEdit, after: edited.data.walletBalance },
  );
  const redisSpentAfterEdit = await redis.hget(rkey.spent(userId, period), limited.id);
  const pgSpent = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM transactions
      WHERE user_id = $1 AND category_id = $2 AND type = 'spend'
        AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3`,
    [userId, limited.id, period],
  );
  check('после правки spent: PG = Redis', Number(pgSpent.rows[0]!.total) === Number(redisSpentAfterEdit), {
    pg: pgSpent.rows[0]!.total,
    redis: redisSpentAfterEdit,
  });

  console.log('\n[10] Удаление транзакции');
  const beforeDelete = await pool.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE id = $1',
    [wallet.id],
  );
  const removed = await api<{ walletBalance: number }>(
    'DELETE',
    `/api/transactions/${spend.data.transactionId}`,
  );
  check('удаление = 200', removed.status === 200, removed.data);
  check(
    'деньги вернулись в кошелёк (+50000)',
    removed.data.walletBalance === Number(beforeDelete.rows[0]!.balance) + 50_000,
    { before: beforeDelete.rows[0]!.balance, after: removed.data.walletBalance },
  );

  console.log('\n[11] История и аналитика');
  const history = await api<{ items: unknown[] }>('GET', '/api/transactions?days=30');
  check('история не пуста', history.status === 200 && history.data.items.length > 0);
  const dist = await api<{ total: number; items: Array<{ share: number }> }>(
    'GET',
    '/api/analytics/distribution',
  );
  check('donut отдаёт распределение', dist.status === 200 && dist.data.total > 0, dist.data);
  const velocity = await api<{ points: unknown[]; pace: number }>('GET', '/api/analytics/velocity');
  check(
    'velocity отдаёт кривую по дням',
    velocity.status === 200 && velocity.data.points.length >= 28,
    { points: velocity.data.points.length },
  );

  console.log(failures === 0 ? '\n🎉 Все проверки пройдены' : `\n💥 Провалено проверок: ${failures}`);
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
