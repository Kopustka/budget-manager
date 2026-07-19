/**
 * Каталог оформления категорий и кошельков: иконки и цвета.
 *
 * Список общий для фронта и бэка намеренно: фронт рисует из него палитру
 * выбора, бэк по нему же валидирует — иначе в базу попадёт имя иконки,
 * которое интерфейс не умеет отрисовать, и вместо значка будет заглушка.
 */

/** Ключи иконок. Каждому соответствует компонент Lucide в CategoryIcon. */
export const CATEGORY_ICONS = [
  'wallet',
  'shopping-cart',
  'coffee',
  'car',
  'home',
  'gift',
  'smartphone',
  'heart-pulse',
  'plane',
  'shirt',
  'graduation-cap',
  'dumbbell',
  'pizza',
  'fuel',
  'baby',
  'paw-print',
  'briefcase',
  'piggy-bank',
  'trending-up',
  'banknote',
] as const;

export type CategoryIconName = (typeof CATEGORY_ICONS)[number];

/**
 * Цвета категорий. Это токены темы, а не сырые hex: они уже проверены на
 * контраст и различимость при дальтонизме (см. features/analytics/chart-palette).
 */
export const CATEGORY_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
  'var(--color-success)',
  'var(--color-danger)',
] as const;

/** Потолки на количество: матрица главного экрана перестаёт читаться раньше. */
export const MAX_WALLETS = 12;
export const MAX_CATEGORIES_PER_KIND = 24;

/** Цвет для новой категории — первый свободный слот, иначе по кругу. */
export function nextCategoryColor(usedColors: readonly (string | null)[]): string {
  const used = new Set(usedColors.filter((c): c is string => c !== null));
  const free = CATEGORY_COLORS.find((c) => !used.has(c));
  return free ?? CATEGORY_COLORS[used.size % CATEGORY_COLORS.length] ?? CATEGORY_COLORS[0];
}
