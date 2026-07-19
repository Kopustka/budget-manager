import type { CreateWalletInput, Wallet } from '@budget/shared';
import { api } from '@/shared/api/client';

export const walletApi = {
  list: () => api.get<{ items: Wallet[] }>('/wallets').then((r) => r.items),

  create: (input: CreateWalletInput) => api.post<Wallet>('/wallets', input),
};
