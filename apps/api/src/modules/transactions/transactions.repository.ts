import type { HistoryTotals, Transaction, TransactionType } from '@budget/shared';
import { pool } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { periodRange } from '../../shared/period.js';

interface TxRow {
  id: string;
  profile_id: string;
  type: TransactionType;
  wallet_id: string | null;
  category_id: string | null;
  subcategory: string | null;
  amount: string;
  comment: string | null;
  occurred_at: Date;
  created_at: Date;
}

function toTx(r: TxRow): Transaction {
  return {
    id: r.id,
    profileId: r.profile_id,
    type: r.type,
    walletId: r.wallet_id,
    categoryId: r.category_id,
    subcategory: r.subcategory,
    amount: Number(r.amount),
    comment: r.comment,
    occurredAt: r.occurred_at.toISOString(),
    createdAt: r.created_at.toISOString(),
  };
}

/** Параметры выборки истории: диапазон и необязательные фильтры. */
export interface HistoryQuery {
  profileId: string;
  from?: Date | string | null;
  to?: Date | string | null;
  type?: TransactionType | null;
  categoryId?: string | null;
  limit?: number;
}

export interface InsertTxInput {
  profileId: string;
  type: TransactionType;
  walletId: string;
  categoryId: string;
  amount: number;
  subcategory?: string | null;
  comment?: string | null;
  occurredAt: Date;
}

export const transactionsRepository = {
  async insert(db: Queryable, input: InsertTxInput): Promise<Transaction> {
    const { rows } = await db.query<TxRow>(
      `INSERT INTO transactions
         (profile_id, type, wallet_id, category_id, subcategory, amount, comment, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.profileId,
        input.type,
        input.walletId,
        input.categoryId,
        input.subcategory ?? null,
        input.amount,
        input.comment ?? null,
        input.occurredAt,
      ],
    );
    return toTx(rows[0]!);
  },

  /** Транзакция пользователя. `forUpdate` — блокировка на время правки/удаления. */
  async findOwned(
    db: Queryable,
    profileId: string,
    id: string,
    forUpdate = false,
  ): Promise<Transaction> {
    const { rows } = await db.query<TxRow>(
      `SELECT * FROM transactions WHERE id = $1 AND profile_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, profileId],
    );
    if (!rows[0]) throw new NotFoundError('Транзакция не найдена');
    return toTx(rows[0]);
  },

  async update(
    db: Queryable,
    id: string,
    fields: {
      amount: number;
      categoryId: string;
      subcategory: string | null;
      comment: string | null;
    },
  ): Promise<Transaction> {
    const { rows } = await db.query<TxRow>(
      `UPDATE transactions
          SET amount = $2, category_id = $3, subcategory = $4, comment = $5
        WHERE id = $1
        RETURNING *`,
      [id, fields.amount, fields.categoryId, fields.subcategory, fields.comment],
    );
    if (!rows[0]) throw new NotFoundError('Транзакция не найдена');
    return toTx(rows[0]);
  },

  async remove(db: Queryable, id: string): Promise<void> {
    await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  },

  /** Лента истории за последние N дней (карусель времени). */
  async listRecent(profileId: string, days: number, limit = 200): Promise<Transaction[]> {
    const { rows } = await pool.query<TxRow>(
      `SELECT * FROM transactions
        WHERE profile_id = $1 AND occurred_at >= now() - ($2 || ' days')::interval
        ORDER BY occurred_at DESC
        LIMIT $3`,
      [profileId, String(days), limit],
    );
    return rows.map(toTx);
  },

  /** Транзакции за конкретный день (UTC). */
  async listByDay(profileId: string, day: string): Promise<Transaction[]> {
    const { rows } = await pool.query<TxRow>(
      `SELECT * FROM transactions
        WHERE profile_id = $1
          AND occurred_at >= $2::date
          AND occurred_at < ($2::date + interval '1 day')
        ORDER BY occurred_at DESC`,
      [profileId, day],
    );
    return rows.map(toTx);
  },

  /**
   * Лента истории с фильтрами. Диапазон и сортировка ложатся на индекс
   * idx_tx_profile_time, поэтому фильтры добавлены как необязательные условия,
   * а не как отдельные запросы.
   */
  async listRange(input: HistoryQuery): Promise<Transaction[]> {
    const { rows } = await pool.query<TxRow>(
      `SELECT * FROM transactions
        WHERE profile_id = $1
          AND ($2::timestamptz IS NULL OR occurred_at >= $2)
          AND ($3::timestamptz IS NULL OR occurred_at < $3)
          AND ($4::text IS NULL OR type = $4)
          AND ($5::uuid IS NULL OR category_id = $5)
        ORDER BY occurred_at DESC
        LIMIT $6`,
      [
        input.profileId,
        input.from ?? null,
        input.to ?? null,
        input.type ?? null,
        input.categoryId ?? null,
        input.limit ?? 500,
      ],
    );
    return rows.map(toTx);
  },

  /** Итоги за тот же отрезок и с теми же фильтрами, что и лента. */
  async totalsRange(input: HistoryQuery): Promise<HistoryTotals> {
    const { rows } = await pool.query<{ income: string; expense: string; count: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) AS income,
         COALESCE(SUM(amount) FILTER (WHERE type = 'spend'), 0)   AS expense,
         COUNT(*)                                                  AS count
        FROM transactions
       WHERE profile_id = $1
         AND ($2::timestamptz IS NULL OR occurred_at >= $2)
         AND ($3::timestamptz IS NULL OR occurred_at < $3)
         AND ($4::text IS NULL OR type = $4)
         AND ($5::uuid IS NULL OR category_id = $5)`,
      [
        input.profileId,
        input.from ?? null,
        input.to ?? null,
        input.type ?? null,
        input.categoryId ?? null,
      ],
    );
    const row = rows[0];
    return {
      income: Number(row?.income ?? 0),
      expense: Number(row?.expense ?? 0),
      count: Number(row?.count ?? 0),
    };
  },

  /**
   * Сумма трат по категории за период — источник истины для пересчёта Redis-кэша
   * spent после любой операции (создание/правка/удаление).
   */
  async sumSpent(
    db: Queryable,
    profileId: string,
    categoryId: string,
    period: string,
    monthStartDay = 1,
  ): Promise<number> {
    const { start, end } = periodRange(period, monthStartDay);
    const { rows } = await db.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE profile_id = $1 AND category_id = $2 AND type = 'spend'
          AND occurred_at >= $3 AND occurred_at < $4`,
      [profileId, categoryId, start, end],
    );
    return Number(rows[0]?.total ?? 0);
  },

  /** Распределение трат по категориям за период (donut). */
  async spentByCategory(
    profileId: string,
    period: string,
    monthStartDay = 1,
  ): Promise<Array<{ categoryId: string; total: number }>> {
    const { start, end } = periodRange(period, monthStartDay);
    const { rows } = await pool.query<{ category_id: string; total: string }>(
      `SELECT category_id, SUM(amount) AS total
         FROM transactions
        WHERE profile_id = $1 AND type = 'spend' AND category_id IS NOT NULL
          AND occurred_at >= $2 AND occurred_at < $3
        GROUP BY category_id
        ORDER BY total DESC`,
      [profileId, start, end],
    );
    return rows.map((r) => ({ categoryId: r.category_id, total: Number(r.total) }));
  },

  /** Траты по дням периода (velocity). */
  async spentByDay(
    profileId: string,
    period: string,
    monthStartDay = 1,
  ): Promise<Array<{ day: string; total: number }>> {
    const { start, end } = periodRange(period, monthStartDay);
    const { rows } = await pool.query<{ day: string; total: string }>(
      `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              SUM(amount) AS total
         FROM transactions
        WHERE profile_id = $1 AND type = 'spend'
          AND occurred_at >= $2 AND occurred_at < $3
        GROUP BY 1
        ORDER BY 1`,
      [profileId, start, end],
    );
    return rows.map((r) => ({ day: r.day, total: Number(r.total) }));
  },
};
