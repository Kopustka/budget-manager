import type { Wallet } from '@budget/shared';
import { pool } from '../../config/db.js';
import type { Queryable } from '../../shared/db-types.js';
import { NotFoundError } from '../../shared/errors.js';
import { asDuplicateError } from '../../shared/pg-errors.js';

interface WalletRow {
  id: string;
  user_id: string;
  name: string;
  balance: string;
  currency: string;
  created_at: Date;
}

function toWallet(r: WalletRow): Wallet {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    balance: Number(r.balance),
    currency: r.currency,
    createdAt: r.created_at.toISOString(),
  };
}

export const walletsRepository = {
  async listByUser(userId: string): Promise<Wallet[]> {
    const { rows } = await pool.query<WalletRow>(
      'SELECT * FROM wallets WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return rows.map(toWallet);
  },

  async countByUser(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*) FROM wallets WHERE user_id = $1',
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  },

  /**
   * Создание кошелька. Валюту не спрашиваем: суммы хранятся в минорных
   * единицах валюты пользователя, разные валюты в одном балансе не сложатся.
   */
  async create(
    userId: string,
    name: string,
    balance: number,
    currency: string,
  ): Promise<Wallet> {
    try {
      const { rows } = await pool.query<WalletRow>(
        `INSERT INTO wallets (user_id, name, balance, currency)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [userId, name, balance, currency],
      );
      return toWallet(rows[0]!);
    } catch (err) {
      throw asDuplicateError(err, 'Кошелёк с таким названием уже есть');
    }
  },

  /**
   * Кошелёк пользователя. `forUpdate` берёт строчную блокировку — обязателен
   * внутри транзакции, чтобы параллельные списания не разъехались по балансу.
   */
  async findOwned(
    db: Queryable,
    userId: string,
    walletId: string,
    forUpdate = false,
  ): Promise<Wallet> {
    const { rows } = await db.query<WalletRow>(
      `SELECT * FROM wallets WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [walletId, userId],
    );
    if (!rows[0]) throw new NotFoundError('Кошелёк не найден');
    return toWallet(rows[0]);
  },

  /** Изменить баланс на delta (может быть отрицательной) и вернуть новый. */
  async applyDelta(db: Queryable, walletId: string, delta: number): Promise<number> {
    const { rows } = await db.query<{ balance: string }>(
      'UPDATE wallets SET balance = balance + $2 WHERE id = $1 RETURNING balance',
      [walletId, delta],
    );
    if (!rows[0]) throw new NotFoundError('Кошелёк не найден');
    return Number(rows[0].balance);
  },
};
