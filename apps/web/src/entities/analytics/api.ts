import type {
  DistributionResponse,
  ForecastResponse,
  NoSpendResponse,
  VelocityResponse,
} from '@budget/shared';
import { api } from '@/shared/api/client';

export const analyticsApi = {
  /** Распределение трат по категориям за период (donut). */
  distribution: (period?: string) =>
    api.get<DistributionResponse>(`/analytics/distribution${period ? `?period=${period}` : ''}`),

  /** Факт нарастающим итогом против равномерной кривой (velocity). */
  velocity: (period?: string) =>
    api.get<VelocityResponse>(`/analytics/velocity${period ? `?period=${period}` : ''}`),

  /** Прогноз исчерпания бюджета по среднему темпу трат. */
  forecast: (period?: string) =>
    api.get<ForecastResponse>(`/analytics/forecast${period ? `?period=${period}` : ''}`),

  /** Дни без трат и серии. */
  noSpend: (period?: string) =>
    api.get<NoSpendResponse>(`/analytics/no-spend${period ? `?period=${period}` : ''}`),
};
