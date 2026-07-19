import { ValidationError } from './errors.js';

/** Работа с периодом YYYY-MM (UTC) — единица агрегации лимитов и трат. */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertPeriod(period: string): string {
  if (!PERIOD_RE.test(period)) {
    throw new ValidationError(`Некорректный период: ${period} (ожидается YYYY-MM)`);
  }
  return period;
}

/** Период, которому принадлежит дата. */
export function periodOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Полуинтервал [start, end) периода в UTC. */
export function periodRange(period: string): { start: Date; end: Date } {
  assertPeriod(period);
  const [y, m] = period.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/** Количество дней в периоде. */
export function daysInPeriod(period: string): number {
  const { start, end } = periodRange(period);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
