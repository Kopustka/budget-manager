import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../config/db.js';

/**
 * Лёгкий раннер миграций: применяет неприменённые файлы migrations/*.sql
 * по порядку имени, каждый — в отдельной транзакции, и фиксирует в schema_migrations.
 * Прозрачно и без внешних CLI (ESM-friendly).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.name));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        file,
      ]);
    });
    count += 1;
    // eslint-disable-next-line no-console
    console.log(`✅ применена миграция: ${file}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    count === 0 ? 'Нет новых миграций — БД актуальна.' : `Готово: ${count} шт.`,
  );
  await pool.end();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Ошибка миграции:', err);
  process.exit(1);
});
