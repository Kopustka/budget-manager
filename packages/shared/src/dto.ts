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

export const dndResultSchema = z.object({
  transactionId: z.string().uuid(),
  walletBalance: z.number().int(),
  categorySpent: z.number().int(),
  categoryLimit: z.number().int().nullable(),
  isOverdraft: z.boolean(),
});
export type DndResult = z.infer<typeof dndResultSchema>;
