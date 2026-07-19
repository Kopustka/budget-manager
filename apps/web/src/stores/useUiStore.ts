import { create } from 'zustand';

/** Состояние интерфейса: шторки, тосты, выбранный день карусели. */

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

/** Разделы нижней навигации. */
export type Tab = 'home' | 'history' | 'analytics' | 'settings';

interface UiState {
  /** Выбранный день карусели времени (YYYY-MM-DD, UTC). */
  selectedDay: string;
  /** Активный раздел. Живёт в сторе, чтобы экраны могли уводить друг на друга. */
  tab: Tab;
  toasts: Toast[];
  setSelectedDay: (day: string) => void;
  /** Вернуть дату операции на сегодня — при открытии шторок записи. */
  resetSelectedDay: () => void;
  setTab: (tab: Tab) => void;
  /**
   * Фильтр, с которым нужно открыть «Историю». Его выставляет шторка категории,
   * а экран истории забирает и сбрасывает — иначе фильтр залипнет при следующем
   * заходе на вкладку.
   */
  historyFilter: { categoryId: string } | null;
  setHistoryFilter: (filter: { categoryId: string } | null) => void;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

/**
 * Сегодня в локальном времени пользователя. Через `toISOString()` считать
 * нельзя: под утро в восточных поясах UTC-дата отстаёт на сутки, и календарь
 * подсвечивал бы вчерашнее число как сегодняшнее.
 */
function todayKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export const useUiStore = create<UiState>((set) => ({
  selectedDay: todayKey(),
  tab: 'home',
  toasts: [],


  setSelectedDay: (selectedDay) => set({ selectedDay }),
  resetSelectedDay: () => set({ selectedDay: todayKey() }),
  setTab: (tab) => set({ tab }),
  historyFilter: null,
  setHistoryFilter: (historyFilter) => set({ historyFilter }),

  notify: (message, tone = 'info') => {
    const id = ++toastId;
    // Показываем один тост за раз: стопка перекрывала баланс в шапке.
    set({ toasts: [{ id, message, tone }] });
    // 3 секунды — успеть прочитать, но не мешать следующему действию.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
