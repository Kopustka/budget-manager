import type {
  DndEventInput,
  DndResult,
  EditTransactionInput,
  HistoryFilters,
  HistoryTotals,
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

  /** История за отрезок с фильтрами. Итоги считает сервер — по всему отрезку, а не по странице. */
  history: (filters: HistoryFilters) => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.type) params.set('type', filters.type);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    return api.get<{ items: Transaction[]; totals?: HistoryTotals }>(
      `/transactions?${params.toString()}`,
    );
  },

  edit: (id: string, input: EditTransactionInput) =>
    api.patch<DndResponse>(`/transactions/${id}`, input),

  /** toWalletBalance приходит только при отмене перевода — там балансов два. */
  remove: (id: string) =>
    api.delete<{ walletBalance: number; toWalletBalance: number | null }>(`/transactions/${id}`),
};
