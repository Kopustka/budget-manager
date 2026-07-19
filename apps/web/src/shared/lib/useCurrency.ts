import { useSettingsStore } from '@/stores/useSettingsStore';

/**
 * Валюта пользователя для форматирования сумм.
 * Отдельный хук, чтобы компоненты не тянули весь стор настроек ради одного поля.
 */
export function useCurrency(): string {
  return useSettingsStore((s) => s.currency);
}
