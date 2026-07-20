import { create } from 'zustand';
import type {
  CreatePlannedInput,
  PlannedOccurrence,
  PlannedSummary,
  PlannedTransaction,
} from '@budget/shared';
import { plannedApi } from '@/entities/planned/api';
import { useBudgetStore } from './useBudgetStore';

/**
 * Календарь обязательств: правила, экземпляры на 30 дней и свободный остаток.
 *
 * Подтверждение списания создаёт настоящую трату, поэтому после него
 * перезагружаются кошельки и категории: баланс и spent меняются на сервере,
 * и оставлять на экране прежние цифры нельзя.
 */
interface PlannedState {
  rules: PlannedTransaction[];
  occurrences: PlannedOccurrence[];
  summary: PlannedSummary | null;
  loading: boolean;
  busy: boolean;

  load: () => Promise<void>;
  create: (input: CreatePlannedInput) => Promise<void>;
  update: (id: string, input: { name?: string; amount?: number }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  confirm: (id: string, dueDate: string) => Promise<void>;
  skip: (id: string, dueDate: string) => Promise<void>;
}

export const usePlannedStore = create<PlannedState>((set, get) => ({
  rules: [],
  occurrences: [],
  summary: null,
  loading: false,
  busy: false,

  async load() {
    set({ loading: true });
    try {
      const [list, summary] = await Promise.all([plannedApi.list(), plannedApi.summary()]);
      set({ rules: list.rules, occurrences: list.occurrences, summary, loading: false });
    } catch {
      // Не критично: календарь просто останется пустым, остальной экран работает.
      set({ loading: false });
    }
  },

  async create(input) {
    await plannedApi.create(input);
    await get().load();
  },

  async update(id, input) {
    await plannedApi.update(id, input);
    await get().load();
  },

  async remove(id) {
    await plannedApi.remove(id);
    await get().load();
  },

  async confirm(id, dueDate) {
    set({ busy: true });
    try {
      await plannedApi.confirm(id, dueDate);
      // Деньги ушли по-настоящему — справочники обязаны это увидеть.
      await Promise.all([get().load(), useBudgetStore.getState().load()]);
    } finally {
      set({ busy: false });
    }
  },

  async skip(id, dueDate) {
    set({ busy: true });
    try {
      await plannedApi.skip(id, dueDate);
      await get().load();
    } finally {
      set({ busy: false });
    }
  },
}));
