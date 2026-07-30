import type { CreateWalletInput, UpdateWalletInput, Wallet } from '@budget/shared';
import { api } from '@/shared/api/client';

export const walletApi = {
  list: () => api.get<{ items: Wallet[] }>('/wallets').then((r) => r.items),

  create: (input: CreateWalletInput) => api.post<Wallet>('/wallets', input),

  /** Правка названия и/или коррекция баланса. */
  update: (walletId: string, input: UpdateWalletInput) =>
    api.patch<Wallet>(`/wallets/${walletId}`, input),

  /** Удаление кошелька. Операции по нему остаются в истории без кошелька. */
  remove: (walletId: string) => api.delete<void>(`/wallets/${walletId}`),
};
