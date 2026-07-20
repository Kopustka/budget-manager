import { CATEGORY_COLORS } from '@budget/shared';
import type { PoolClient } from '../../config/db.js';

/**
 * Стартовый набор для нового профиля.
 *
 * Без него профиль выглядит как сломанное приложение: перетаскивать нечего и
 * некуда. Значения нейтральные — пользователь переименует под себя.
 *
 * Цвета берём из каталога, а не хексами: по этому же списку API валидирует
 * правку категории (см. миграцию 0004_category_colors.sql).
 */
const DEFAULT_WALLET_NAME = 'Основной';

const [chart1, chart2, chart3, chart4] = CATEGORY_COLORS;

const DEFAULT_CATEGORIES: Array<{
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
}> = [
  { name: 'Зарплата', kind: 'income', icon: 'wallet', color: 'var(--color-success)' },
  { name: 'Продукты', kind: 'expense', icon: 'shopping-cart', color: chart1 },
  { name: 'Кафе', kind: 'expense', icon: 'coffee', color: chart2 },
  { name: 'Транспорт', kind: 'expense', icon: 'car', color: chart3 },
  { name: 'Дом', kind: 'expense', icon: 'home', color: chart4 },
];

/**
 * Создать стартовые кошелёк и категории профиля.
 *
 * Валюта кошелька — валюта профиля: суммы хранятся в минорных единицах именно
 * её, и кошелёк в чужой валюте не сложился бы с остальными в общий баланс.
 */
export async function provisionDefaults(
  client: PoolClient,
  profileId: string,
  currency: string,
): Promise<void> {
  await client.query(
    `INSERT INTO wallets (profile_id, name, balance, currency) VALUES ($1, $2, 0, $3)`,
    [profileId, DEFAULT_WALLET_NAME, currency],
  );

  for (const category of DEFAULT_CATEGORIES) {
    await client.query(
      `INSERT INTO categories (profile_id, name, kind, icon, color) VALUES ($1, $2, $3, $4, $5)`,
      [profileId, category.name, category.kind, category.icon, category.color],
    );
  }
}
