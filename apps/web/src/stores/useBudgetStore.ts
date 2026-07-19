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
  applyDndResult: (result: DndPatch) => void;
  applyEditResult: (result: DndPatch) => void;
  /** Удаление: транзакция уходит из ленты, баланс приходит из ответа,
   *  а spent категории пересчитывает бэкенд — поэтому дотягиваем справочники. */
  applyRemoval: (transactionId: string, walletBalance: number) => Promise<void>;
}

/** Общая форма ответа DnD-ядра — им же отвечает и правка транзакции. */
interface DndPatch {
  transaction: Transaction;
  walletBalance: number;
  categorySpent: number;
  categoryLimit: number | null;
  isOverdraft: boolean;
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

  applyEditResult({ transaction, walletBalance, categorySpent, categoryLimit, isOverdraft }) {
    set((state) => ({
      wallets: state.wallets.map((w) =>
        w.id === transaction.walletId ? { ...w, balance: walletBalance } : w,
      ),
      categories: state.categories.map((c) =>
        c.id === transaction.categoryId && c.kind === 'expense'
          ? { ...c, spent: categorySpent, limit: categoryLimit, isOverdraft }
          : c,
      ),
      // Правка может сменить категорию, поэтому заменяем запись целиком.
      transactions: state.transactions.map((t) => (t.id === transaction.id ? transaction : t)),
    }));
  },

  async applyRemoval(transactionId, walletBalance) {
    const removed = useBudgetStore.getState().transactions.find((t) => t.id === transactionId);
    set((state) => ({
      transactions: state.transactions.filter((t) => t.id !== transactionId),
      wallets: state.wallets.map((w) =>
        removed && w.id === removed.walletId ? { ...w, balance: walletBalance } : w,
      ),
    }));
    // Точный spent знает только бэкенд — обновляем категории отдельным запросом.
    try {
      set({ categories: await categoryApi.list() });
    } catch {
      // Молча: баланс и лента уже верны, статистика подтянется при следующей загрузке.
    }
  },
}));
