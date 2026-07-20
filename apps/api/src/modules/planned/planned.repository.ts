import type { PlannedTransaction } from '@budget/shared';
import { pool } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { asDuplicateError } from '../../shared/pg-errors.js';

interface PlannedRow {
  id: string;
  profile_id: string;
  category_id: string | null;
  wallet_id: string | null;
  name: string;
  amount: string;
  recurrence: 'once' | 'monthly';
  due_date: Date | null;
  due_day: number | null;
  active: boolean;
  created_at: Date;
}

/** DATE из PostgreSQL приходит в локальной зоне процесса — режем по UTC-полям. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toPlanned(r: PlannedRow): PlannedTransaction {
  return {
    id: r.id,
    profileId: r.profile_id,
    categoryId: r.category_id,
    walletId: r.wallet_id,
    name: r.name,
    amount: Number(r.amount),
    recurrence: r.recurrence,
    dueDate: r.due_date ? dateKey(r.due_date) : null,
    dueDay: r.due_day,
    active: r.active,
    createdAt: r.created_at.toISOString(),
  };
}

export interface SettlementRow {
  plannedId: string;
  dueDate: string;
  status: 'paid' | 'skipped';
  transactionId: string | null;
}

export const plannedRepository = {
  async listByProfile(profileId: string, onlyActive = true): Promise<PlannedTransaction[]> {
    const { rows } = await pool.query<PlannedRow>(
      `SELECT * FROM planned_transactions
        WHERE profile_id = $1 AND ($2::boolean IS NOT TRUE OR active)
        ORDER BY created_at`,
      [profileId, onlyActive],
    );
    return rows.map(toPlanned);
  },

  async findOwned(db: Queryable, profileId: string, id: string): Promise<PlannedTransaction> {
    const { rows } = await db.query<PlannedRow>(
      'SELECT * FROM planned_transactions WHERE id = $1 AND profile_id = $2',
      [id, profileId],
    );
    if (!rows[0]) throw new NotFoundError('Событие календаря не найдено');
    return toPlanned(rows[0]);
  },

  async create(
    profileId: string,
    input: {
      name: string;
      amount: number;
      categoryId: string | null;
      walletId: string | null;
      recurrence: 'once' | 'monthly';
      dueDate: string | null;
      dueDay: number | null;
    },
  ): Promise<PlannedTransaction> {
    try {
      const { rows } = await pool.query<PlannedRow>(
        `INSERT INTO planned_transactions
           (profile_id, name, amount, category_id, wallet_id, recurrence, due_date, due_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          profileId,
          input.name,
          input.amount,
          input.categoryId,
          input.walletId,
          input.recurrence,
          input.dueDate,
          input.dueDay,
        ],
      );
      return toPlanned(rows[0]!);
    } catch (err) {
      throw asDuplicateError(err, 'Событие с таким названием уже есть');
    }
  },

  /** Правка правила. COALESCE: NULL в параметре — «не трогай», а не «обнули». */
  async update(
    profileId: string,
    id: string,
    patch: {
      name?: string;
      amount?: number;
      categoryId?: string | null;
      walletId?: string | null;
      dueDate?: string;
      dueDay?: number;
      active?: boolean;
    },
  ): Promise<PlannedTransaction> {
    try {
      const { rows } = await pool.query<PlannedRow>(
        `UPDATE planned_transactions
            SET name        = COALESCE($3, name),
                amount      = COALESCE($4, amount),
                category_id = COALESCE($5, category_id),
                wallet_id   = COALESCE($6, wallet_id),
                due_date    = CASE WHEN recurrence = 'once'    THEN COALESCE($7::date, due_date) ELSE NULL END,
                due_day     = CASE WHEN recurrence = 'monthly' THEN COALESCE($8::smallint, due_day) ELSE NULL END,
                active      = COALESCE($9, active)
          WHERE id = $1 AND profile_id = $2
        RETURNING *`,
        [
          id,
          profileId,
          patch.name ?? null,
          patch.amount ?? null,
          patch.categoryId ?? null,
          patch.walletId ?? null,
          patch.dueDate ?? null,
          patch.dueDay ?? null,
          patch.active ?? null,
        ],
      );
      if (!rows[0]) throw new NotFoundError('Событие календаря не найдено');
      return toPlanned(rows[0]);
    } catch (err) {
      throw asDuplicateError(err, 'Событие с таким названием уже есть');
    }
  },

  async remove(profileId: string, id: string): Promise<void> {
    const { rowCount } = await pool.query(
      'DELETE FROM planned_transactions WHERE id = $1 AND profile_id = $2',
      [id, profileId],
    );
    if (!rowCount) throw new NotFoundError('Событие календаря не найдено');
  },

  /** Решения пользователя по датам в окне — из них берутся статусы экземпляров. */
  async settlementsInRange(
    profileId: string,
    from: string,
    to: string,
  ): Promise<SettlementRow[]> {
    const { rows } = await pool.query<{
      planned_id: string;
      due_date: Date;
      status: 'paid' | 'skipped';
      transaction_id: string | null;
    }>(
      `SELECT s.planned_id, s.due_date, s.status, s.transaction_id
         FROM planned_settlements s
         JOIN planned_transactions p ON p.id = s.planned_id
        WHERE p.profile_id = $1 AND s.due_date >= $2::date AND s.due_date <= $3::date`,
      [profileId, from, to],
    );
    return rows.map((r) => ({
      plannedId: r.planned_id,
      dueDate: dateKey(r.due_date),
      status: r.status,
      transactionId: r.transaction_id,
    }));
  },

  /**
   * Зафиксировать решение по дате.
   *
   * ON CONFLICT DO NOTHING делает подтверждение идемпотентным: повторный тап
   * или гонка двух запросов не спишут деньги дважды — вторая попытка просто
   * не вставит строку, и вызывающий код увидит это по rowCount.
   */
  async settle(
    db: Queryable,
    plannedId: string,
    dueDate: string,
    status: 'paid' | 'skipped',
    transactionId: string | null,
  ): Promise<boolean> {
    const { rowCount } = await db.query(
      `INSERT INTO planned_settlements (planned_id, due_date, status, transaction_id)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (planned_id, due_date) DO NOTHING`,
      [plannedId, dueDate, status, transactionId],
    );
    return (rowCount ?? 0) > 0;
  },

  /** Отменить решение — событие снова становится ожидающим. */
  async unsettle(plannedId: string, dueDate: string): Promise<void> {
    await pool.query(
      'DELETE FROM planned_settlements WHERE planned_id = $1 AND due_date = $2::date',
      [plannedId, dueDate],
    );
  },
};
