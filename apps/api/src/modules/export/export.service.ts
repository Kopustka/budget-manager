import type { Transaction, User } from '@budget/shared';
import type { ProfileScope } from '../../modules/profiles/profiles.repository.js';
import { pool } from '../../config/db.js';

/**
 * Выгрузка операций в CSV.
 *
 * Разделитель — точка с запятой, а числа с запятой в дробной части: так файл
 * открывается в Excel с русской локалью без «мастера импорта». Добавляем BOM,
 * иначе Excel читает UTF-8 как ANSI и кириллица превращается в кракозябры.
 */

const BOM = '﻿';
const SEP = ';';

const HEADER = [
  'Дата',
  'Время',
  'Тип',
  'Сумма',
  'Валюта',
  'Кошелёк',
  'Категория',
  'Подкатегория',
  'Комментарий',
];

/** Строка выборки: колонки приходят из PostgreSQL в snake_case. */
interface ExportRow {
  type: Transaction['type'];
  amount: string;
  subcategory: string | null;
  comment: string | null;
  occurred_at: Date;
  wallet_name: string | null;
  category_name: string | null;
}

/** Экранирование по RFC 4180: кавычки удваиваются, поле берётся в кавычки. */
function csvCell(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

function csvAmount(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}

export interface ExportResult {
  csv: Buffer;
  rows: number;
  fileName: string;
}

export const exportService = {
  /** Собрать CSV за диапазон (обе границы необязательны). */
  async build(profile: ProfileScope, from?: string, to?: string): Promise<ExportResult> {
    const { rows } = await pool.query<ExportRow>(
      `SELECT t.*, w.name AS wallet_name, c.name AS category_name
         FROM transactions t
         LEFT JOIN wallets w ON w.id = t.wallet_id
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.profile_id = $1
          AND ($2::timestamptz IS NULL OR t.occurred_at >= $2)
          AND ($3::timestamptz IS NULL OR t.occurred_at < $3)
        ORDER BY t.occurred_at`,
      [profile.id, from ?? null, to ?? null],
    );

    const lines = [HEADER.join(SEP)];
    for (const row of rows) {
      const occurred = row.occurred_at;
      lines.push(
        [
          csvCell(occurred.toISOString().slice(0, 10)),
          csvCell(occurred.toISOString().slice(11, 16)),
          csvCell(row.type === 'deposit' ? 'Доход' : 'Расход'),
          csvAmount(Number(row.amount)),
          csvCell(profile.currency),
          csvCell(row.wallet_name),
          csvCell(row.category_name),
          csvCell(row.subcategory),
          csvCell(row.comment),
        ].join(SEP),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = from || to ? `${(from ?? 'начало').slice(0, 10)}_${(to ?? stamp).slice(0, 10)}` : 'все';

    return {
      csv: Buffer.from(BOM + lines.join('\r\n'), 'utf8'),
      rows: rows.length,
      fileName: `budget-manager_${suffix}.csv`,
    };
  },
};
