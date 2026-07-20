import type {
  CreatePlannedInput,
  PlannedOccurrence,
  PlannedSummary,
  PlannedTransaction,
  UpdatePlannedInput,
} from '@budget/shared';
import { api } from '@/shared/api/client';

export interface PlannedListResponse {
  /** Правила: то, что пользователь завёл. */
  rules: PlannedTransaction[];
  /** Развёрнутые на окно даты списаний со статусами. */
  occurrences: PlannedOccurrence[];
}

export const plannedApi = {
  list: (days?: number) =>
    api.get<PlannedListResponse>(`/planned${days ? `?days=${days}` : ''}`),

  summary: () => api.get<PlannedSummary>('/planned/summary'),

  create: (input: CreatePlannedInput) => api.post<PlannedTransaction>('/planned', input),

  update: (id: string, input: UpdatePlannedInput) =>
    api.patch<PlannedTransaction>(`/planned/${id}`, input),

  remove: (id: string) => api.delete<{ removedId: string }>(`/planned/${id}`),

  /** Подтвердить: событие превращается в настоящую трату. */
  confirm: (id: string, dueDate: string) =>
    api.post<PlannedOccurrence>(`/planned/${id}/confirm`, { dueDate }),

  /** Пропустить: деньги остаются, обязательство снимается. */
  skip: (id: string, dueDate: string) =>
    api.post<PlannedOccurrence>(`/planned/${id}/skip`, { dueDate }),
};
