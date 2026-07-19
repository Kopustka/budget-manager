import type {
  DndEventInput,
  DndResult,
  EditTransactionInput,
  Transaction,
} from '@budget/shared';
import { api } from '@/shared/api/client';

/** Ответ DnD-ядра: результат + сама транзакция для мгновенной вставки в ленту. */
export interface DndResponse extends DndResult {
  transaction: Transaction;
}

export const transactionApi = {
  /** Событие матрицы: зачисление или списание. */
  dnd: (input: DndEventInput) => api.post<DndResponse>('/dnd', input),

  listRecent: (days = 30) =>
    api.get<{ items: Transaction[] }>(`/transactions?days=${days}`).then((r) => r.items),

  listByDay: (day: string) =>
    api.get<{ items: Transaction[] }>(`/transactions?day=${day}`).then((r) => r.items),

  edit: (id: string, input: EditTransactionInput) =>
    api.patch<DndResponse>(`/transactions/${id}`, input),

  remove: (id: string) => api.delete<{ walletBalance: number }>(`/transactions/${id}`),
};
