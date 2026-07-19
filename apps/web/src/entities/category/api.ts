import type { Category } from '@budget/shared';
import { api } from '@/shared/api/client';

/** Категория вместе с прогрессом по лимиту — то, что рисует матрица. */
export interface CategoryWithStats extends Category {
  spent: number | null;
  limit: number | null;
  isOverdraft: boolean;
}

export const categoryApi = {
  list: (period?: string) =>
    api
      .get<{ period: string; items: CategoryWithStats[] }>(
        `/categories${period ? `?period=${period}` : ''}`,
      )
      .then((r) => r.items),

  setLimit: (categoryId: string, period: string, limitAmount: number) =>
    api.put(`/categories/${categoryId}/limit`, { period, limitAmount }),
};
