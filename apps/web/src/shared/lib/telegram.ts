/**
 * Обёртка над Telegram WebApp SDK.
 * Всё, что зависит от `window.Telegram`, живёт здесь — остальной код работает
 * с обычными функциями и не падает в браузере вне Telegram.
 */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'error' | 'success' | 'warning';

interface TelegramWebApp {
  initData: string;
  version: string;
  colorScheme: 'light' | 'dark';
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent(event: string, handler: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: HapticStyle): void;
    notificationOccurred(type: NotificationType): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export const isInsideTelegram = (): boolean => Boolean(getWebApp()?.initData);

/**
 * initData для авторизации. Вне Telegram берём подписанную строку из
 * VITE_DEV_INIT_DATA (генерируется локально: `npm run dev-init-data -w apps/api`),
 * чтобы фронт можно было гонять в обычном браузере, не ослабляя проверку на бэке.
 */
export function getInitData(): string {
  const fromTelegram = getWebApp()?.initData;
  if (fromTelegram) return fromTelegram;
  return import.meta.env.VITE_DEV_INIT_DATA ?? '';
}

/** Прокинуть safe-area из Telegram в CSS-переменные (env() внутри WebView неточен). */
function syncSafeArea(app: TelegramWebApp): void {
  const inset = app.safeAreaInset;
  if (!inset) return;
  document.documentElement.style.setProperty('--tg-safe-top', `${inset.top}px`);
  document.documentElement.style.setProperty('--tg-safe-bottom', `${inset.bottom}px`);
}

/** Инициализация Mini App: разворот на весь экран, цвета, блокировка свайп-закрытия. */
export function initTelegram(): void {
  const app = getWebApp();
  if (!app) return;

  app.ready();
  app.expand();
  // Свайп вниз внутри приложения не должен схлопывать окно — иначе DnD-жесты
  // конфликтуют с системным жестом закрытия (правило gesture conflict prevention).
  app.disableVerticalSwipes?.();
  app.setHeaderColor?.('#0D0E12');
  app.setBackgroundColor?.('#0D0E12');

  syncSafeArea(app);
  app.onEvent('safeAreaChanged', () => syncSafeArea(app));
  app.onEvent('viewportChanged', () => syncSafeArea(app));
}

/**
 * Haptic-обёртка. Вибрация — только на значимых событиях (подтверждение,
 * запрет, овердрафт), иначе она обесценивается.
 */
export const haptics = {
  impact(style: HapticStyle = 'light'): void {
    getWebApp()?.HapticFeedback?.impactOccurred(style);
  },
  success(): void {
    getWebApp()?.HapticFeedback?.notificationOccurred('success');
  },
  /** Запрещённый жест матрицы или овердрафт. */
  error(): void {
    getWebApp()?.HapticFeedback?.notificationOccurred('error');
  },
  warning(): void {
    getWebApp()?.HapticFeedback?.notificationOccurred('warning');
  },
  selection(): void {
    getWebApp()?.HapticFeedback?.selectionChanged();
  },
};
