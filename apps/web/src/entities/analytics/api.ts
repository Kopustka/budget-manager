import type { DistributionResponse, VelocityResponse } from '@budget/shared';
import { api } from '@/shared/api/client';

export const analyticsApi = {
  /** Распределение трат по категориям за период (donut). */
  distribution: (period?: string) =>
    api.get<DistributionResponse>(`/analytics/distribution${period ? `?period=${period}` : ''}`),

  /** Факт нарастающим итогом против равномерной кривой (velocity). */
  velocity: (period?: string) =>
    api.get<VelocityResponse>(`/analytics/velocity${period ? `?period=${period}` : ''}`),
};
