import type { Profile } from '@budget/shared';
import { pool, withTransaction } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { asDuplicateError } from '../../shared/pg-errors.js';
import { provisionDefaults } from '../users/users.onboarding.js';

interface ProfileRow {
  id: string;
  user_id: string;
  name: string;
  currency: string;
  month_start_day: number;
  created_at: Date;
}

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    currency: r.currency,
    monthStartDay: r.month_start_day,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Профиль вместе с Telegram-адресатом владельца.
 *
 * Бэкенд почти везде оперирует именно этим: область видимости данных берётся из
 * профиля, а уведомления надо кому-то отправить. Держать их порознь значило бы
 * ходить в users на каждой трате.
 */
export interface ProfileScope extends Profile {
  telegramId: number;
}

export const profilesRepository = {
  async listByUser(userId: string): Promise<Profile[]> {
    const { rows } = await pool.query<ProfileRow>(
      'SELECT * FROM profiles WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return rows.map(toProfile);
  },

  async findOwned(db: Queryable, userId: string, profileId: string): Promise<Profile> {
    const { rows } = await db.query<ProfileRow>(
      'SELECT * FROM profiles WHERE id = $1 AND user_id = $2',
      [profileId, userId],
    );
    if (!rows[0]) throw new NotFoundError('Профиль не найден');
    return toProfile(rows[0]);
  },

  /** Активный профиль пользователя вместе с адресом для пушей. */
  async findActiveScope(userId: string): Promise<ProfileScope | null> {
    const { rows } = await pool.query<ProfileRow & { telegram_id: string }>(
      `SELECT p.*, u.telegram_id
         FROM users u
         JOIN profiles p ON p.id = u.active_profile_id
        WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0];
    return row ? { ...toProfile(row), telegramId: Number(row.telegram_id) } : null;
  },

  /**
   * Создать профиль вместе со стартовым набором справочников.
   *
   * Кошелёк и категории заводятся той же транзакцией: профиль без них выглядит
   * как сломанное приложение — перетаскивать нечего и некуда.
   */
  async create(
    userId: string,
    input: { name: string; currency: string; monthStartDay: number },
  ): Promise<Profile> {
    return withTransaction(async (client) => {
      let row: ProfileRow;
      try {
        const { rows } = await client.query<ProfileRow>(
          `INSERT INTO profiles (user_id, name, currency, month_start_day)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [userId, input.name, input.currency, input.monthStartDay],
        );
        row = rows[0]!;
      } catch (err) {
        throw asDuplicateError(err, 'Профиль с таким названием уже есть');
      }
      await provisionDefaults(client, row.id, input.currency);
      return toProfile(row);
    });
  },

  async rename(userId: string, profileId: string, name: string): Promise<Profile> {
    try {
      const { rows } = await pool.query<ProfileRow>(
        'UPDATE profiles SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
        [profileId, userId, name],
      );
      if (!rows[0]) throw new NotFoundError('Профиль не найден');
      return toProfile(rows[0]);
    } catch (err) {
      throw asDuplicateError(err, 'Профиль с таким названием уже есть');
    }
  },

  /** Настройки профиля (валюта и день начала месяца). */
  async updateSettings(
    db: Queryable,
    profileId: string,
    patch: { currency?: string; monthStartDay?: number },
  ): Promise<Profile> {
    const { rows } = await db.query<ProfileRow>(
      `UPDATE profiles
          SET currency = COALESCE($2, currency),
              month_start_day = COALESCE($3, month_start_day)
        WHERE id = $1
      RETURNING *`,
      [profileId, patch.currency ?? null, patch.monthStartDay ?? null],
    );
    if (!rows[0]) throw new NotFoundError('Профиль не найден');
    return toProfile(rows[0]);
  },

  async setActive(userId: string, profileId: string): Promise<void> {
    await pool.query('UPDATE users SET active_profile_id = $2 WHERE id = $1', [userId, profileId]);
  },

  /**
   * Удалить профиль. Данные уходят каскадом — на это и рассчитана схема.
   *
   * Последний профиль удалить нельзя: пользователь остался бы без области
   * видимости вовсе, и приложению нечего было бы открыть. Если удаляют
   * активный, активным становится следующий по времени создания — иначе
   * интерфейс после удаления упёрся бы в пустоту.
   */
  async remove(userId: string, profileId: string): Promise<Profile> {
    return withTransaction(async (client) => {
      const { rows: all } = await client.query<{ id: string }>(
        'SELECT id FROM profiles WHERE user_id = $1 ORDER BY created_at',
        [userId],
      );
      if (all.length <= 1) {
        throw new ConflictError('Нельзя удалить единственный профиль');
      }

      const profile = await this.findOwned(client, userId, profileId);
      const fallback = all.find((p) => p.id !== profileId)!.id;

      // Снимаем указатель до удаления: ON DELETE SET NULL оставил бы аккаунт
      // без активного профиля, и следующий запрос получил бы 401.
      await client.query(
        'UPDATE users SET active_profile_id = $2 WHERE id = $1 AND active_profile_id = $3',
        [userId, fallback, profileId],
      );
      await client.query('DELETE FROM profiles WHERE id = $1 AND user_id = $2', [profileId, userId]);
      return profile;
    });
  },
};
