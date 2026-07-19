import type { Wallet } from '@budget/shared';
import { api } from '@/shared/api/client';

export const walletApi = {
  list: () => api.get<{ items: Wallet[] }>('/wallets').then((r) => r.items),
};
