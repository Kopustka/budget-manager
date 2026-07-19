import type { User } from '@budget/shared';
import { pool, withTransaction } from '../../config/db.js';
import { provisionDefaults } from './users.onboarding.js';

interface UserRow {
  id: string;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  created_at: Date;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    createdAt: r.created_at.toISOString(),
  };
}

export const usersRepository = {
  /**
   * Найти или создать пользователя по Telegram ID (идемпотентно).
   * Новому сразу выдаём стартовый кошелёк и категории — одной транзакцией,
   * чтобы не появился пользователь без справочников.
   */
  async upsertByTelegram(input: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
  }): Promise<User> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<UserRow & { inserted: boolean }>(
        `INSERT INTO users (telegram_id, username, first_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (telegram_id) DO UPDATE
           SET username = EXCLUDED.username,
               first_name = EXCLUDED.first_name
         RETURNING *, (xmax = 0) AS inserted`,
        [input.telegramId, input.username ?? null, input.firstName ?? null],
      );

      const row = rows[0]!;
      if (row.inserted) await provisionDefaults(client, row.id);
      return toUser(row);
    });
  },

  async findByTelegramId(telegramId: number): Promise<User | null> {
    const { rows } = await pool.query<UserRow>(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId],
    );
    return rows[0] ? toUser(rows[0]) : null;
  },
};
