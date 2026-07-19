import { z } from 'zod';
import { CURRENCY_CODES, MAX_MONTH_START_DAY, MIN_MONTH_START_DAY } from './currency.js';
import type { TransactionType } from './types.js';

/** Zod-схемы запросов/ответов API. Используются для валидации на бэке и типизации на фронте. */

export const amountSchema = z
  .number()
  .int('Сумма должна быть в минорных единицах (integer)')
  .positive('Сумма должна быть положительной');

/** POST /api/dnd — обработка события Drag-and-Drop матрицы */
export const dndEventSchema = z.object({
  source: z.enum(['income', 'wallet', 'expense']),
  target: z.enum(['income', 'wallet', 'expense']),
  walletId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amount: amountSchema,
  subcategory: z.string().max(64).nullish(),
  comment: z.string().max(280).nullish(),
  /** ISO-дата события (для добавления задним числом из карусели) */
  occurredAt: z.string().datetime().optional(),
});
export type DndEventInput = z.infer<typeof dndEventSchema>;

/** PATCH /api/transactions/:id — редактирование транзакции */
export const editTransactionSchema = z.object({
  amount: amountSchema.optional(),
  subcategory: z.string().max(64).nullish(),
  comment: z.string().max(280).nullish(),
  categoryId: z.string().uuid().optional(),
});
export type EditTransactionInput = z.infer<typeof editTransactionSchema>;

/** PUT /api/categories/:id/limit — установка лимита на период */
export const setLimitSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период в формате YYYY-MM'),
  limitAmount: z.number().int().nonnegative(),
});
export type SetLimitInput = z.infer<typeof setLimitSchema>;

/** Ответ аналитики: распределение по категориям (donut) */
export interface CategoryDistributionItem {
  categoryId: string;
  name: string;
  color: string | null;
  icon: string | null;
  spent: number;
  limit: number | null;
  /** Доля в общих тратах периода, 0..1 */
  share: number;
  isOverdraft: boolean;
}

export interface DistributionResponse {
  period: string;
  total: number;
  items: CategoryDistributionItem[];
}

/** Ответ аналитики: velocity — факт нарастающим итогом против равномерной кривой */
export interface VelocityPoint {
  day: string;
  spent: number;
  cumulative: number;
  ideal: number;
}

export interface VelocityResponse {
  period: string;
  total: number;
  /** Сумма лимитов категорий за период (база идеальной кривой), null если лимитов нет */
  budget: number | null;
  points: VelocityPoint[];
  /** Опережение факта над идеалом на сегодня (минорные единицы); >0 = тратим быстрее плана */
  pace: number;
}

/** PATCH /api/settings — день начала расчётного месяца */
export const updateSettingsSchema = z.object({
  monthStartDay: z
    .number()
    .int()
    .min(MIN_MONTH_START_DAY)
    .max(MAX_MONTH_START_DAY, `День начала месяца — от 1 до ${MAX_MONTH_START_DAY}`),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * POST /api/settings/currency — смена валюты с пересчётом сумм.
 * Курс: сколько единиц новой валюты в одной единице текущей.
 */
export const changeCurrencySchema = z.object({
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  rate: z
    .number()
    .positive('Курс должен быть больше нуля')
    .max(100_000, 'Слишком большой курс — проверьте значение'),
});
export type ChangeCurrencyInput = z.infer<typeof changeCurrencySchema>;

/** POST /api/export — выгрузка операций файлом в чат бота */
export const exportRequestSchema = z.object({
  /** Начало диапазона (ISO). Без него — с первой операции. */
  from: z.string().datetime().optional(),
  /** Конец диапазона (ISO, не включая). Без него — по настоящий момент. */
  to: z.string().datetime().optional(),
});
export type ExportRequestInput = z.infer<typeof exportRequestSchema>;

export interface SettingsResponse {
  currency: string;
  monthStartDay: number;
  /** Границы текущего периода — чтобы UI показал, какой отрезок получился. */
  period: string;
  periodStart: string;
  periodEnd: string;
}

/** Фильтры ленты истории. */
export interface HistoryFilters {
  from?: string;
  to?: string;
  type?: TransactionType;
  categoryId?: string;
}

export interface HistoryTotals {
  income: number;
  expense: number;
  count: number;
}

export const dndResultSchema = z.object({
  transactionId: z.string().uuid(),
  walletBalance: z.number().int(),
  categorySpent: z.number().int(),
  categoryLimit: z.number().int().nullable(),
  isOverdraft: z.boolean(),
});
export type DndResult = z.infer<typeof dndResultSchema>;
