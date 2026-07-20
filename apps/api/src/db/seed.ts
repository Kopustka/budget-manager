import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { cache } from '../redis/cache.js';
import { periodOf } from '../shared/period.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { profilesRepository } from '../modules/profiles/profiles.repository.js';

/**
 * Сид тестовых данных.
 *
 * Справочники заводить не нужно: профиль создаётся вместе с пользователем и уже
 * несёт стартовые кошелёк и категории (`provisionDefaults`). Сиду остаётся то,
 * чего в стартовом наборе нет и быть не должно — деньги на балансе и лимит,
 * чтобы было на чём проверять сценарии.
 */
const TEST_TELEGRAM_ID = 111_111_111;

/** Баланс 100 000.00 и лимит 20 000.00 в минорных единицах. */
const WALLET_BALANCE = 10_000_000;
const GROCERIES_LIMIT = 2_000_000;

async function seed(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({
    telegramId: TEST_TELEGRAM_ID,
    username: 'test_user',
    firstName: 'Тест',
  });

  const profile = await profilesRepository.findActiveScope(user.id);
  if (!profile) throw new Error('У тестового пользователя нет активного профиля');

  const { rows: wallets } = await pool.query<{ id: string; balance: string }>(
    'SELECT id, balance FROM wallets WHERE profile_id = $1 ORDER BY created_at LIMIT 1',
    [profile.id],
  );
  const wallet = wallets[0];
  if (!wallet) throw new Error('В профиле нет кошелька — стартовый набор не создался');

  // Идемпотентность: пополняем только пустой кошелёк, иначе повторный прогон
  // сида раздувал бы баланс и ломал ожидания проверок.
  if (Number(wallet.balance) === 0) {
    await pool.query('UPDATE wallets SET balance = $2 WHERE id = $1', [wallet.id, WALLET_BALANCE]);
  }
  const balance = Number(wallet.balance) === 0 ? WALLET_BALANCE : Number(wallet.balance);

  const { rows: expenses } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories
      WHERE profile_id = $1 AND kind = 'expense' ORDER BY created_at`,
    [profile.id],
  );
  const groceries = expenses.find((c) => c.name === 'Продукты') ?? expenses[0];
  if (!groceries) throw new Error('В профиле нет категорий расхода');

  const period = periodOf(new Date(), profile.monthStartDay);
  await pool.query(
    `INSERT INTO category_limits (category_id, period, limit_amount)
     VALUES ($1, $2, $3) ON CONFLICT (category_id, period) DO NOTHING`,
    [groceries.id, period, GROCERIES_LIMIT],
  );

  // Прогрев Redis
  cache.setWalletBalance(profile.id, wallet.id, balance);
  cache.setLimit(profile.id, period, groceries.id, GROCERIES_LIMIT);
  for (const c of expenses) cache.incrSpent(profile.id, period, c.id, 0);

  // eslint-disable-next-line no-console
  console.log('✅ Сид готов:', {
    user: user.id,
    telegramId: user.telegramId,
    profile: profile.id,
    walletId: wallet.id,
    expenses: expenses.map((c) => c.name),
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
