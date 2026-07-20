import { CATEGORY_COLORS } from '@budget/shared';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { cache } from '../redis/cache.js';
import { periodOf } from '../shared/period.js';
import { usersRepository } from '../modules/users/users.repository.js';

/**
 * Сид тестовых данных: пользователь + кошелёк + категории (доход/расход) + лимит.
 * Прогревает Redis-слой (баланс, лимит). Идемпотентен для пользователя (upsert),
 * остальное создаётся, только если у юзера ещё нет кошельков.
 */
const TEST_TELEGRAM_ID = 111_111_111;

async function seed(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({
    telegramId: TEST_TELEGRAM_ID,
    username: 'test_user',
    firstName: 'Тест',
  });

  const { rows: existing } = await pool.query(
    'SELECT id FROM wallets WHERE user_id = $1 LIMIT 1',
    [user.id],
  );
  if (existing.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Сид уже применён для тестового пользователя:', user.id);
    await cleanup();
    return;
  }

  // Кошелёк с балансом 100 000.00 (в минорных = 10_000_000)
  const walletBalance = 10_000_000;
  const { rows: walletRows } = await pool.query<{ id: string }>(
    `INSERT INTO wallets (user_id, name, balance, currency)
     VALUES ($1, 'Основной', $2, 'RUB') RETURNING id`,
    [user.id, walletBalance],
  );
  const walletId = walletRows[0]!.id;

  // Цвета берём из каталога, а не хексами: по этому же списку API валидирует
  // правку категории, и записанное мимо него значение нельзя было бы сохранить
  // обратно (см. миграцию 0004_category_colors.sql).
  const [chart1, chart2, chart3] = CATEGORY_COLORS;
  const success = 'var(--color-success)' satisfies (typeof CATEGORY_COLORS)[number];

  const { rows: incomeRows } = await pool.query<{ id: string }>(
    `INSERT INTO categories (user_id, name, kind, icon, color)
     VALUES ($1, 'Зарплата', 'income', 'wallet', $2) RETURNING id`,
    [user.id, success],
  );
  const incomeId = incomeRows[0]!.id;

  const expenses = [
    ['Продукты', 'shopping-cart', chart1],
    ['Кафе', 'coffee', chart2],
    ['Транспорт', 'car', chart3],
  ] as const;
  const expenseIds: string[] = [];
  for (const [name, icon, color] of expenses) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO categories (user_id, name, kind, icon, color)
       VALUES ($1, $2, 'expense', $3, $4) RETURNING id`,
      [user.id, name, icon, color],
    );
    expenseIds.push(rows[0]!.id);
  }

  const period = periodOf(new Date());
  // Лимит на «Продукты» 20 000.00 = 2_000_000
  const groceriesLimit = 2_000_000;
  await pool.query(
    `INSERT INTO category_limits (category_id, period, limit_amount)
     VALUES ($1, $2, $3) ON CONFLICT (category_id, period) DO NOTHING`,
    [expenseIds[0], period, groceriesLimit],
  );

  // Прогрев Redis
  cache.setWalletBalance(user.id, walletId, walletBalance);
  cache.setLimit(user.id, period, expenseIds[0]!, groceriesLimit);
  for (const id of expenseIds) {
    cache.incrSpent(user.id, period, id, 0);
  }

  // eslint-disable-next-line no-console
  console.log('✅ Сид готов:', {
    user: user.id,
    telegramId: user.telegramId,
    walletId,
    incomeId,
    expenseIds,
    period,
  });
  await cleanup();
}

async function cleanup(): Promise<void> {
  await pool.end();
  redis.disconnect();
}

seed().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Ошибка сида:', err);
  await cleanup();
  process.exit(1);
});
