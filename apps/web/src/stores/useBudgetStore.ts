import { create } from 'zustand';
import type { Transaction, Wallet } from '@budget/shared';
import { walletApi } from '@/entities/wallet/api';
import { categoryApi, type CategoryWithStats } from '@/entities/category/api';
import { transactionApi } from '@/entities/transaction/api';

/**
 * Основной стор: кошельки, категории со статистикой и лента истории.
 * Ответ DnD-ядра уже содержит новые баланс/spent, поэтому применяем его точечно
 * (`applyDndResult`), не перезагружая весь экран.
 */
interface BudgetState {
  wallets: Wallet[];
  categories: CategoryWithStats[];
  transactions: Transaction[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  applyDndResult: (result: {
    transaction: Transaction;
    walletBalance: number;
    categorySpent: number;
    categoryLimit: number | null;
    isOverdraft: boolean;
  }) => void;
}

export const useBudgetStore = create<BudgetState>((set) => ({
  wallets: [],
  categories: [],
  transactions: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const [wallets, categories, transactions] = await Promise.all([
        walletApi.list(),
        categoryApi.list(),
        transactionApi.listRecent(30),
      ]);
      set({ wallets, categories, transactions, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Не удалось загрузить данные',
      });
    }
  },

  applyDndResult({ transaction, walletBalance, categorySpent, categoryLimit, isOverdraft }) {
    set((state) => ({
      wallets: state.wallets.map((w) =>
        w.id === transaction.walletId ? { ...w, balance: walletBalance } : w,
      ),
      categories: state.categories.map((c) =>
        c.id === transaction.categoryId && c.kind === 'expense'
          ? { ...c, spent: categorySpent, limit: categoryLimit, isOverdraft }
          : c,
      ),
      transactions: [transaction, ...state.transactions],
    }));
  },
}));
