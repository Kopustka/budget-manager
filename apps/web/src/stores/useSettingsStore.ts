import { create } from 'zustand';
import type { SettingsResponse } from '@budget/shared';
import { settingsApi } from '@/entities/settings/api';

/**
 * Настройки пользователя. Валюта отсюда попадает во всё форматирование денег,
 * поэтому стор наполняется до первого рендера сумм.
 */
interface SettingsState {
  currency: string;
  monthStartDay: number;
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
  loading: boolean;

  load: () => Promise<void>;
  apply: (settings: SettingsResponse) => void;
  setCurrency: (currency: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // До ответа сервера показываем рубль — совпадает с умолчанием на бэкенде.
  currency: 'RUB',
  monthStartDay: 1,
  period: '',
  periodStart: null,
  periodEnd: null,
  loading: false,

  async load() {
    set({ loading: true });
    try {
      const settings = await settingsApi.get();
      set({ ...settings, loading: false });
    } catch {
      // Не критично: приложение работает с умолчаниями, ошибку покажет экран данных.
      set({ loading: false });
    }
  },

  apply: (settings) => set({ ...settings }),
  setCurrency: (currency) => set({ currency }),
}));
