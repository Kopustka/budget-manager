import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';

/**
 * Перевод денег между кошельками (жест «кошелёк → кошелёк»).
 *
 * Главное, что здесь проверяется, — сохранение суммы: сколько ушло с одного
 * кошелька, столько пришло на другой, и общий итог по профилю не сдвинулся.
 * Отдельно сверяется, что перевод не притворяется доходом или расходом в
 * итогах истории — иначе учёт раздувался бы на каждом переносе денег.
 *
 * Требует запущенный API. Запуск: npm run smoke:transfers --workspace apps/api
 */

const BASE = `http://127.0.0.1:${env.API_PORT}`;
const TEST_TELEGRAM_ID = 111_111_111;
const PREFIX = 'smoke-transfer';

function makeInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'smoke-transfers',
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

async function cleanup(profileId: string): Promise<void> {
  const pattern = `${PREFIX}%`;
  // Переводы адресуются обоими кошельками, поэтому чистим и по to_wallet_id:
  // фильтр только по wallet_id оставил бы половину записей висеть.
  await pool.query(
    `DELETE FROM transactions WHERE profile_id = $1
       AND (wallet_id IN (SELECT id FROM wallets WHERE profile_id = $1 AND name LIKE $2)
         OR to_wallet_id IN (SELECT id FROM wallets WHERE profile_id = $1 AND name LIKE $2))`,
    [profileId, pattern],
  );
  await pool.query('DELETE FROM wallets WHERE profile_id = $1 AND name LIKE $2', [
    profileId,
    pattern,
  ]);
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:profile:${profileId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

interface WalletDto {
  id: string;
  balance: number;
}
interface DndDto {
  transactionId: string;
  walletBalance: number;
  toWalletBalance: number | null;
  transaction: { type: string; walletId: string; toWalletId: string | null; categoryId: null };
}

async function balanceOf(id: string): Promise<number> {
  const { data } = await api<{ items: WalletDto[] }>('GET', '/api/wallets');
  return data.items.find((w) => w.id === id)?.balance ?? Number.NaN;
}

/**
 * Итоги истории за сегодня. Отдаются только для запроса с диапазоном:
 * у ветки `?days=N` их нет, и обращение к `totals` вернуло бы undefined.
 */
async function historyTotals(): Promise<{ income: number; expense: number }> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const { data } = await api<{ totals: { income: number; expense: number } }>(
    'GET',
    `/api/transactions?from=${encodeURIComponent(from.toISOString())}`,
  );
  return data?.totals ?? { income: Number.NaN, expense: Number.NaN };
}

async function main(): Promise<void> {
  const me = await api<{ activeProfileId: string }>('GET', '/api/me');
  if (me.status !== 200) throw new Error('API недоступен или initData не принят');
  const profileId = me.data.activeProfileId;
  await cleanup(profileId);

  console.log('\n[1] Подготовка кошельков');
  const from = await api<WalletDto>('POST', '/api/wallets', {
    name: `${PREFIX} Карта`,
    balance: 100_000,
  });
  const to = await api<WalletDto>('POST', '/api/wallets', {
    name: `${PREFIX} Наличные`,
    balance: 5_000,
  });
  check('оба кошелька созданы', from.status === 201 && to.status === 201, {
    from: from.data,
    to: to.data,
  });
  const totalBefore = from.data.balance + to.data.balance;
  // Итоги снимаем до перевода: профиль общий для смоук-тестов, и сравнение
  // «до/после» устойчивее, чем ожидание нулей в чужих данных.
  const totalsBefore = await historyTotals();

  console.log('\n[2] Перевод 30 000');
  const transfer = await api<DndDto>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'wallet',
    walletId: from.data.id,
    toWalletId: to.data.id,
    amount: 30_000,
    comment: `${PREFIX} перевод`,
  });
  check('перевод проведён (201)', transfer.status === 201, transfer.data);
  check('списано с источника', transfer.data?.walletBalance === 70_000, transfer.data);
  check('зачислено получателю', transfer.data?.toWalletBalance === 35_000, transfer.data);
  check('тип операции — transfer', transfer.data?.transaction?.type === 'transfer', transfer.data);
  check('категории у перевода нет', transfer.data?.transaction?.categoryId === null, transfer.data);

  const totalAfter = (await balanceOf(from.data.id)) + (await balanceOf(to.data.id));
  check('сумма денег в бюджете не изменилась', totalAfter === totalBefore, {
    totalBefore,
    totalAfter,
  });

  console.log('\n[3] Перевод не считается доходом или расходом');
  const totalsAfter = await historyTotals();
  check(
    'итоги доходов и расходов не сдвинулись',
    totalsAfter.income === totalsBefore.income && totalsAfter.expense === totalsBefore.expense,
    { totalsBefore, totalsAfter },
  );

  console.log('\n[4] Отказы');
  const self = await api<ApiErrorBody>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'wallet',
    walletId: from.data.id,
    toWalletId: from.data.id,
    amount: 1_000,
  });
  check('перевод самому себе отклонён', self.status === 422, self.data);

  const tooMuch = await api<ApiErrorBody>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'wallet',
    walletId: from.data.id,
    toWalletId: to.data.id,
    amount: 999_999_999,
  });
  check('перевод сверх баланса отклонён', tooMuch.status === 409, tooMuch.data);

  const noTarget = await api<ApiErrorBody>('POST', '/api/dnd', {
    source: 'wallet',
    target: 'wallet',
    walletId: from.data.id,
    amount: 1_000,
  });
  check('перевод без получателя отклонён', noTarget.status === 422, noTarget.data);

  console.log('\n[5] Правка суммы перевода');
  const edited = await api<DndDto>('PATCH', `/api/transactions/${transfer.data.transactionId}`, {
    amount: 10_000,
  });
  check('правка принята', edited.status === 200, edited.data);
  check('источник пересчитан', edited.data?.walletBalance === 90_000, edited.data);
  check('получатель пересчитан', edited.data?.toWalletBalance === 15_000, edited.data);

  console.log('\n[6] Отмена перевода возвращает деньги');
  const removed = await api<{ walletBalance: number; toWalletBalance: number | null }>(
    'DELETE',
    `/api/transactions/${transfer.data.transactionId}`,
  );
  check('перевод удалён', removed.status === 200, removed.data);
  check('баланс источника восстановлен', removed.data?.walletBalance === 100_000, removed.data);
  check('баланс получателя восстановлен', removed.data?.toWalletBalance === 5_000, removed.data);

  console.log('\n[7] Сверка кэша Redis с PostgreSQL');
  const pg = await pool.query<{ id: string; balance: string }>(
    'SELECT id, balance FROM wallets WHERE id = ANY($1)',
    [[from.data.id, to.data.id]],
  );
  for (const row of pg.rows) {
    const cached = await redis.get(`${env.REDIS_NAMESPACE}:profile:${profileId}:wallet:${row.id}`);
    // Кэш мог не прогреться, если по кошельку не было операций — это не ошибка,
    // расхождение непустого значения с базой — ошибка.
    check(
      `кэш кошелька ${row.id.slice(0, 8)} совпадает с базой`,
      cached === null || Number(cached) === Number(row.balance),
      { cached, pg: row.balance },
    );
  }

  await cleanup(profileId);
  console.log(
    failures === 0 ? '\n✅ Все проверки переводов пройдены' : `\n❌ Провалено проверок: ${failures}`,
  );
  await pool.end();
  redis.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Смоук упал:', err);
  process.exit(1);
});
