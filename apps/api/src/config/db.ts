import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

/**
 * Единый пул соединений PostgreSQL. PostgreSQL — source of truth.
 * Денежные значения храним в BIGINT (минорные единицы), pg по умолчанию
 * отдаёт BIGINT строкой — приводим к number на уровне репозиториев.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Неожиданная ошибка idle-клиента PG', err);
});

export type PoolClient = pg.PoolClient;

/**
 * Выполнить callback внутри одной транзакции. Коммит при успехе, ROLLBACK при ошибке.
 * Используется для атомарных Drag-and-Drop операций (Фаза 2).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
