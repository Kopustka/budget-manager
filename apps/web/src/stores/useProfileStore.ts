import { create } from 'zustand';
import type { CreateProfileInput, Profile } from '@budget/shared';
import { profileApi } from '@/entities/profile/api';
import { useBudgetStore } from './useBudgetStore';
import { useSettingsStore } from './useSettingsStore';

/**
 * Профили бюджета и переключение между ними.
 *
 * Смена профиля меняет область видимости всех остальных данных, поэтому стор
 * сам перезагружает справочники и настройки: оставить на экране кошельки одного
 * профиля рядом с валютой другого — худшее из возможных состояний.
 */
interface ProfileState {
  items: Profile[];
  activeId: string | null;
  loading: boolean;
  /** Идёт переключение или удаление — на это время список блокируется. */
  switching: boolean;

  load: () => Promise<void>;
  create: (input: CreateProfileInput) => Promise<void>;
  rename: (profileId: string, name: string) => Promise<void>;
  activate: (profileId: string) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
}

/** Перечитать всё, что зависит от активного профиля. */
async function reloadScopedData(): Promise<void> {
  // Настройки первыми: из них берётся валюта, в которой рисуются все суммы.
  await useSettingsStore.getState().load();
  await useBudgetStore.getState().load();
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  items: [],
  activeId: null,
  loading: false,
  switching: false,

  async load() {
    set({ loading: true });
    try {
      const { items, activeProfileId } = await profileApi.list();
      set({ items, activeId: activeProfileId, loading: false });
    } catch {
      // Не критично: экран настроек покажет пустой список, остальное работает.
      set({ loading: false });
    }
  },

  async create(input) {
    const profile = await profileApi.create(input);
    set((state) => ({ items: [...state.items, profile] }));
    // Созданный профиль сразу открываем: его завели, чтобы им пользоваться.
    await get().activate(profile.id);
  },

  async rename(profileId, name) {
    const updated = await profileApi.rename(profileId, { name });
    set((state) => ({
      items: state.items.map((p) => (p.id === profileId ? updated : p)),
    }));
  },

  async activate(profileId) {
    if (get().activeId === profileId) return;
    set({ switching: true });
    try {
      await profileApi.activate(profileId);
      set({ activeId: profileId });
      await reloadScopedData();
    } finally {
      set({ switching: false });
    }
  },

  async remove(profileId) {
    set({ switching: true });
    try {
      const { activeProfileId, items } = await profileApi.remove(profileId);
      const wasActive = get().activeId === profileId;
      set({ items, activeId: activeProfileId });
      // Перечитываем, только если удалили открытый профиль: иначе на экране
      // остались данные другого, и трогать их незачем.
      if (wasActive) await reloadScopedData();
    } finally {
      set({ switching: false });
    }
  },
}));
