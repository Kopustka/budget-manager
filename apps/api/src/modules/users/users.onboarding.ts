import type { PoolClient } from '../../config/db.js';

/**
 * Стартовый набор для нового пользователя.
 *
 * Без него первый вход выглядит как сломанное приложение: перетаскивать нечего
 * и некуда, а экранов создания кошельков и категорий в этой версии нет.
 * Значения нейтральные — пользователь переименует под себя, когда появится
 * редактирование справочников.
 */
const DEFAULT_WALLET = { name: 'Основной', currency: 'RUB' };

const DEFAULT_CATEGORIES: Array<{
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
}> = [
  { name: 'Зарплата', kind: 'income', icon: 'wallet', color: '#34C759' },
  { name: 'Продукты', kind: 'expense', icon: 'shopping-cart', color: '#007AFF' },
  { name: 'Кафе', kind: 'expense', icon: 'coffee', color: '#FF9500' },
  { name: 'Транспорт', kind: 'expense', icon: 'car', color: '#5856D6' },
  { name: 'Дом', kind: 'expense', icon: 'home', color: '#34C759' },
];

/** Создать стартовые кошелёк и категории. Вызывается только для новых пользователей. */
export async function provisionDefaults(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO wallets (user_id, name, balance, currency) VALUES ($1, $2, 0, $3)`,
    [userId, DEFAULT_WALLET.name, DEFAULT_WALLET.currency],
  );

  for (const category of DEFAULT_CATEGORIES) {
    await client.query(
      `INSERT INTO categories (user_id, name, kind, icon, color) VALUES ($1, $2, $3, $4, $5)`,
      [userId, category.name, category.kind, category.icon, category.color],
    );
  }
}
