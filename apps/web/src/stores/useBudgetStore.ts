import { useMemo } from 'react';
import { create } from 'zustand';
import {
  limitRatio,
  limitStatus,
  type CreateCategoryInput,
  type CreateWalletInput,
  type LimitStatus,
  type Transaction,
  type UpdateCategoryInput,
  type UpdateWalletInput,
  type Wallet,
} from '@budget/shared';
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
  addWallet: (input: CreateWalletInput) => Promise<void>;
  addCategory: (input: CreateCategoryInput) => Promise<void>;
  /** Правка названия и/или коррекция баланса кошелька. */
  updateWallet: (walletId: string, input: UpdateWalletInput) => Promise<void>;
  /** Удаление кошелька: операции по нему осиротеют (walletId → null). */
  deleteWallet: (walletId: string) => Promise<void>;
  /** Правка категории и её месячного плана. */
  updateCategory: (categoryId: string, input: UpdateCategoryInput) => Promise<void>;
  /** Удаление категории/источника: операции по ней осиротеют (categoryId → null). */
  deleteCategory: (categoryId: string) => Promise<void>;
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

  // Созданное дописываем в конец списка, а не перезагружаем всё: порядок
  // создания закрепляет за категорией цвет в аналитике, и полная перезагрузка
  // ради одной записи заодно моргнула бы матрицей.
  async addWallet(input) {
    const wallet = await walletApi.create(input);
    set((state) => ({ wallets: [...state.wallets, wallet] }));
  },

  async addCategory(input) {
    const category = await categoryApi.create(input);
    set((state) => ({ categories: [...state.categories, category] }));
  },

  // Ответ сервера — источник истины по балансу: подставляем кошелёк целиком,
  // а не сшиваем из полей формы. Так коррекция баланса и переименование
  // приходят одним согласованным объектом.
  async updateWallet(walletId, input) {
    const updated = await walletApi.update(walletId, input);
    set((state) => ({
      wallets: state.wallets.map((w) => (w.id === walletId ? updated : w)),
    }));
  },

  // Сервер удаляет кошелёк и обнуляет ссылку у его операций (wallet_id → null).
  // Повторяем это в сторе, чтобы лента тут же перестала указывать на исчезнувший
  // кошелёк, а не ждала перезагрузки экрана.
  async deleteWallet(walletId) {
    await walletApi.remove(walletId);
    set((state) => ({
      wallets: state.wallets.filter((w) => w.id !== walletId),
      transactions: state.transactions.map((t) =>
        t.walletId === walletId ? { ...t, walletId: null } : t,
      ),
    }));
  },

  // Ответ сервера содержит пересчитанные spent и limit — подставляем его целиком,
  // а не собираем новую категорию из полей формы: смена лимита меняет и статус,
  // а он должен считаться по тем же числам, что лежат в базе.
  async updateCategory(categoryId, input) {
    const updated = await categoryApi.update(categoryId, input);
    set((state) => ({
      categories: state.categories.map((c) => (c.id === categoryId ? updated : c)),
    }));
  },

  // Сервер удаляет категорию и обнуляет ссылку у её операций (category_id → null).
  // Убираем её из матрицы и осиротим операции в ленте: история сохранится, но уже
  // без категории — ровно как её отдаст сервер при следующей загрузке.
  async deleteCategory(categoryId) {
    await categoryApi.remove(categoryId);
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== categoryId),
      transactions: state.transactions.map((t) =>
        t.categoryId === categoryId ? { ...t, categoryId: null } : t,
      ),
    }));
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

/* ──────────────────────────── Derived state ────────────────────────────
 *
 * Статус категории нигде не хранится — он вычисляется из плана и факта в
 * момент чтения. Поэтому после Drag-and-Drop достаточно обновить одно число
 * (spent), и карточка перекрашивается сама: рассинхронизироваться с данными
 * посчитанному на лету статусу просто негде.
 */

/** План, факт и вывод по одной категории расхода. */
export interface CategoryBudget {
  spent: number;
  limit: number | null;
  /** Доля израсходованного плана (0..∞); null, если лимита нет. */
  ratio: number | null;
  status: LimitStatus;
}

const NO_BUDGET: CategoryBudget = { spent: 0, limit: null, ratio: null, status: 'NONE' };

function budgetOf(category: CategoryWithStats): CategoryBudget {
  const spent = category.spent ?? 0;
  const limit = category.limit;
  return { spent, limit, ratio: limitRatio(spent, limit), status: limitStatus(spent, limit) };
}

/**
 * План, факт и статус одной категории.
 *
 * Хук, а не селектор для `useBudgetStore`: подписка сравнивает результат по
 * ссылке, а собранный на лету объект нов при каждом вызове — React счёл бы
 * снимок нестабильным и ушёл в бесконечный рендер. Подписываемся на саму запись
 * категории (ссылка стабильна, пока запись не меняли) и считаем статус в useMemo.
 *
 * Подписка идёт по одной категории, а не по всему списку: при Drag-and-Drop
 * меняется spent ровно одной из них, и перерисоваться должна тоже одна карточка.
 */
export function useCategoryBudget(categoryId: string): CategoryBudget {
  const category = useBudgetStore((s) => s.categories.find((c) => c.id === categoryId));
  return useMemo(() => (category ? budgetOf(category) : NO_BUDGET), [category]);
}
