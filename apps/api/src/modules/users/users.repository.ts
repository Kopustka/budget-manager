import type { User } from '@budget/shared';
import { pool, withTransaction } from '../../config/db.js';
import { provisionDefaults } from './users.onboarding.js';

interface UserRow {
  id: string;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  active_profile_id: string | null;
  created_at: Date;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    telegramId: Number(r.telegram_id),
    username: r.username,
    firstName: r.first_name,
    activeProfileId: r.active_profile_id,
    createdAt: r.created_at.toISOString(),
  };
}

/** Имя и валюта первого профиля. Совпадают с умолчаниями в схеме. */
const FIRST_PROFILE_NAME = 'Личный';
const FIRST_PROFILE_CURRENCY = 'RUB';

export const usersRepository = {
  /**
   * Найти или создать пользователя по Telegram ID (идемпотентно).
   *
   * Новому сразу заводим профиль со справочниками — одной транзакцией, чтобы не
   * появился аккаунт без области видимости: приложению нечего было бы открыть.
   */
  async upsertByTelegram(input: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
  }): Promise<User> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (telegram_id, username, first_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (telegram_id) DO UPDATE
           SET username = EXCLUDED.username,
               first_name = EXCLUDED.first_name
         RETURNING *`,
        [input.telegramId, input.username ?? null, input.firstName ?? null],
      );
      const row = rows[0]!;
      if (row.active_profile_id) return toUser(row);

      /*
       * Активного профиля нет. Проверяем существующие, а не полагаемся на
       * «строка только что вставлена»: указатель мог обнулиться и у старого
       * аккаунта, и тогда он навсегда остался бы без профиля.
       */
      const { rows: existing } = await client.query<{ id: string }>(
        'SELECT id FROM profiles WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [row.id],
      );

      let profileId = existing[0]?.id;
      if (!profileId) {
        const { rows: created } = await client.query<{ id: string }>(
          `INSERT INTO profiles (user_id, name, currency) VALUES ($1, $2, $3) RETURNING id`,
          [row.id, FIRST_PROFILE_NAME, FIRST_PROFILE_CURRENCY],
        );
        profileId = created[0]!.id;
        await provisionDefaults(client, profileId, FIRST_PROFILE_CURRENCY);
      }

      await client.query('UPDATE users SET active_profile_id = $2 WHERE id = $1', [
        row.id,
        profileId,
      ]);
      return toUser({ ...row, active_profile_id: profileId });
    });
  },

  async findByTelegramId(telegramId: number): Promise<User | null> {
    const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE telegram_id = $1', [
      telegramId,
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  },
};
