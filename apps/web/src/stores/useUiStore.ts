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
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    // Тост живёт 4 секунды — достаточно, чтобы прочитать, и не мешает работе.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
