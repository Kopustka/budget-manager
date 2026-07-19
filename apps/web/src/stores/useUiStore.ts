import { create } from 'zustand';

/** Состояние интерфейса: шторки, тосты, выбранный день карусели. */

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

interface UiState {
  /** Выбранный день карусели времени (YYYY-MM-DD, UTC). */
  selectedDay: string;
  toasts: Toast[];
  setSelectedDay: (day: string) => void;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set) => ({
  selectedDay: new Date().toISOString().slice(0, 10),
  toasts: [],

  setSelectedDay: (selectedDay) => set({ selectedDay }),

  notify: (message, tone = 'info') => {
    const id = ++toastId;
    // Показываем один тост за раз: стопка перекрывала баланс в шапке.
    set({ toasts: [{ id, message, tone }] });
    // 3 секунды — успеть прочитать, но не мешать следующему действию.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
