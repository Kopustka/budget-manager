import type { ChangeCurrencyInput, SettingsResponse } from '@budget/shared';
import { api } from '@/shared/api/client';

export interface CurrencyChangeResult {
  currency: string;
  rate: number;
  wallets: number;
  transactions: number;
  limits: number;
}

export interface ExportResult {
  sent: boolean;
  rows: number;
  fileName: string;
}

export const settingsApi = {
  get: () => api.get<SettingsResponse>('/settings'),

  setMonthStartDay: (monthStartDay: number) =>
    api.patch<SettingsResponse>('/settings', { monthStartDay }),

  /** Необратимая операция: пересчитывает все суммы по курсу. */
  changeCurrency: (input: ChangeCurrencyInput) =>
    api.post<CurrencyChangeResult>('/settings/currency', input),

  /** Выгрузка приходит файлом в чат бота. */
  exportHistory: (range?: { from?: string; to?: string }) =>
    api.post<ExportResult>('/export', range ?? {}),
};
