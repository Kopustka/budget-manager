/** Форматирование денег. В коде суммы всегда в минорных единицах (копейках). */

const MINOR = 100;

export function toMajor(minor: number): number {
  return minor / MINOR;
}

export function toMinor(major: number): number {
  return Math.round(major * MINOR);
}

/** «12 340 ₽» — без копеек, если они нулевые: так цифры читаются быстрее. */
export function formatMoney(minor: number, currency = 'RUB'): string {
  const hasCents = minor % MINOR !== 0;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(toMajor(minor));
}

/** Компактная запись для плотных мест (карточки категорий): «12,3 тыс». */
export function formatMoneyCompact(minor: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toMajor(minor));
}

export function formatPercent(share: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  }).format(share);
}

const DAY_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function formatDay(iso: string): string {
  return DAY_FMT.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

/** «Сегодня» / «Вчера» / «12 мар» — для заголовков карусели и ленты. */
export function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const diffDays = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      86_400_000,
  );
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return DAY_FMT.format(date);
}
