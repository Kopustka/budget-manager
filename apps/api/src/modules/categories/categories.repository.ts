import type { Category } from '@budget/shared';
import { pool } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { asDuplicateError } from '../../shared/pg-errors.js';

interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  kind: 'income' | 'expense';
  icon: string | null;
  color: string | null;
  created_at: Date;
}

function toCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    icon: r.icon,
    color: r.color,
    createdAt: r.created_at.toISOString(),
  };
}

export const categoriesRepository = {
  async listByUser(userId: string, kind?: 'income' | 'expense'): Promise<Category[]> {
    const { rows } = await pool.query<CategoryRow>(
      `SELECT * FROM categories
        WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2)
        ORDER BY created_at`,
      [userId, kind ?? null],
    );
    return rows.map(toCategory);
  },

  async countByKind(userId: string, kind: 'income' | 'expense'): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*) FROM categories WHERE user_id = $1 AND kind = $2',
      [userId, kind],
    );
    return Number(rows[0]?.count ?? 0);
  },

  async create(
    userId: string,
    input: { name: string; kind: 'income' | 'expense'; icon: string | null; color: string | null },
  ): Promise<Category> {
    try {
      const { rows } = await pool.query<CategoryRow>(
        `INSERT INTO categories (user_id, name, kind, icon, color)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, input.name, input.kind, input.icon, input.color],
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

  async findOwned(db: Queryable, userId: string, categoryId: string): Promise<Category> {
    const { rows } = await db.query<CategoryRow>(
      'SELECT * FROM categories WHERE id = $1 AND user_id = $2',
      [categoryId, userId],
    );
    if (!rows[0]) throw new NotFoundError('Категория не найдена');
    return toCategory(rows[0]);
  },

  /** Лимит категории на период или null, если не задан. */
  async findLimit(db: Queryable, categoryId: string, period: string): Promise<number | null> {
    const { rows } = await db.query<{ limit_amount: string }>(
      'SELECT limit_amount FROM category_limits WHERE category_id = $1 AND period = $2',
      [categoryId, period],
    );
    return rows[0] ? Number(rows[0].limit_amount) : null;
  },

  async setLimit(categoryId: string, period: string, limitAmount: number): Promise<void> {
    await pool.query(
      `INSERT INTO category_limits (category_id, period, limit_amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (category_id, period) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`,
      [categoryId, period, limitAmount],
    );
  },
};
