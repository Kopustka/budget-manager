import type { Category, CreateCategoryInput, UpdateCategoryInput } from '@budget/shared';
import { api } from '@/shared/api/client';

/**
 * Категория вместе с прогрессом по лимиту — то, что рисует матрица.
 *
 * Статуса (SAFE/WARNING/EXCEEDED) здесь намеренно нет, хотя сервер его отдаёт:
 * на клиенте он вычисляется селектором стора из этих же spent и limit. Хранить
 * рядом и числа, и посчитанный по ним вывод — значит завести второй источник
 * истины, который разойдётся с первым на первом же оптимистичном обновлении.
 */
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

  create: (input: CreateCategoryInput) => api.post<CategoryWithStats>('/categories', input),

  /** Правка оформления и/или запланированного бюджета на период. */
  update: (categoryId: string, input: UpdateCategoryInput) =>
    api.patch<CategoryWithStats>(`/categories/${categoryId}`, input),

  setLimit: (categoryId: string, period: string, limitAmount: number) =>
    api.put(`/categories/${categoryId}/limit`, { period, limitAmount }),
};
