import type { Category } from '@budget/shared';
import { pool } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { asDuplicateError } from '../../shared/pg-errors.js';

interface CategoryRow {
  id: string;
  profile_id: string;
  name: string;
  kind: 'income' | 'expense';
  icon: string | null;
  color: string | null;
  created_at: Date;
}

function toCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    kind: r.kind,
    icon: r.icon,
    color: r.color,
    createdAt: r.created_at.toISOString(),
  };
}

export const categoriesRepository = {
  async listByProfile(profileId: string, kind?: 'income' | 'expense'): Promise<Category[]> {
    const { rows } = await pool.query<CategoryRow>(
      `SELECT * FROM categories
        WHERE profile_id = $1 AND ($2::text IS NULL OR kind = $2)
        ORDER BY created_at`,
      [profileId, kind ?? null],
    );
    return rows.map(toCategory);
  },

  async countByKind(profileId: string, kind: 'income' | 'expense'): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*) FROM categories WHERE profile_id = $1 AND kind = $2',
      [profileId, kind],
    );
    return Number(rows[0]?.count ?? 0);
  },

  async create(
    profileId: string,
    input: { name: string; kind: 'income' | 'expense'; icon: string | null; color: string | null },
  ): Promise<Category> {
    try {
      const { rows } = await pool.query<CategoryRow>(
        `INSERT INTO categories (profile_id, name, kind, icon, color)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [profileId, input.name, input.kind, input.icon, input.color],
      );
      return toCategory(rows[0]!);
    } catch (err) {
      throw asDuplicateError(
        err,
        input.kind === 'expense'
          ? 'Категория с таким названием уже есть'
          : 'Источник дохода с таким названием уже есть',
      );
    }
  },

  async findOwned(db: Queryable, profileId: string, categoryId: string): Promise<Category> {
    const { rows } = await db.query<CategoryRow>(
      'SELECT * FROM categories WHERE id = $1 AND profile_id = $2',
      [categoryId, profileId],
    );
    if (!rows[0]) throw new NotFoundError('Категория не найдена');
    return toCategory(rows[0]);
  },

  /**
   * Удалить категорию. Операции по ней остаются в истории: transactions.category_id
   * объявлен ON DELETE SET NULL — они просто теряют категорию. Планы на месяц
   * (category_limits) уходят каскадом, а расписания (planned_transactions) —
   * SET NULL, поэтому календарь события не теряет.
   */
  async remove(profileId: string, categoryId: string): Promise<void> {
    const { rowCount } = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND profile_id = $2',
      [categoryId, profileId],
    );
    if (!rowCount) throw new NotFoundError('Категория не найдена');
  },

  /** Лимит категории на период или null, если не задан. */
  async findLimit(db: Queryable, categoryId: string, period: string): Promise<number | null> {
    const { rows } = await db.query<{ limit_amount: string }>(
      'SELECT limit_amount FROM category_limits WHERE category_id = $1 AND period = $2',
      [categoryId, period],
    );
    return rows[0] ? Number(rows[0].limit_amount) : null;
  },

  /**
   * Правка оформления категории. Переданы только изменённые поля, поэтому
   * COALESCE: NULL в параметре означает «не трогай», а не «обнули».
   */
  async update(
    profileId: string,
    categoryId: string,
    patch: { name?: string; icon?: string; color?: string },
  ): Promise<Category> {
    try {
      const { rows } = await pool.query<CategoryRow>(
        `UPDATE categories
            SET name  = COALESCE($3, name),
                icon  = COALESCE($4, icon),
                color = COALESCE($5, color)
          WHERE id = $1 AND profile_id = $2
        RETURNING *`,
        [categoryId, profileId, patch.name ?? null, patch.icon ?? null, patch.color ?? null],
      );
      if (!rows[0]) throw new NotFoundError('Категория не найдена');
      return toCategory(rows[0]);
    } catch (err) {
      throw asDuplicateError(err, 'Категория с таким названием уже есть');
    }
  },

  /**
   * Upsert плана на период: повторная установка не плодит строк, а обновляет
   * сумму — UNIQUE (category_id, period) делает это одним запросом без гонки
   * «прочитал — не нашёл — вставил», в которой два параллельных сохранения
   * дали бы конфликт вставки.
   */
  async setLimit(categoryId: string, period: string, limitAmount: number): Promise<void> {
    await pool.query(
      `INSERT INTO category_limits (category_id, period, limit_amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (category_id, period) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`,
      [categoryId, period, limitAmount],
    );
  },

  /** Снять план на период. Отсутствие строки — это «лимита нет», не ноль. */
  async removeLimit(categoryId: string, period: string): Promise<void> {
    await pool.query('DELETE FROM category_limits WHERE category_id = $1 AND period = $2', [
      categoryId,
      period,
    ]);
  },
};
