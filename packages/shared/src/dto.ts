import { z } from 'zod';

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

export const dndResultSchema = z.object({
  transactionId: z.string().uuid(),
  walletBalance: z.number().int(),
  categorySpent: z.number().int(),
  categoryLimit: z.number().int().nullable(),
  isOverdraft: z.boolean(),
});
export type DndResult = z.infer<typeof dndResultSchema>;
