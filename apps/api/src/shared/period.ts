import { MAX_MONTH_START_DAY, MIN_MONTH_START_DAY } from '@budget/shared';
import { ValidationError } from './errors.js';

/**
 * Расчётный период — единица агрегации лимитов и трат.
 *
 * Метка периода — `YYYY-MM`, но границы зависят от настройки пользователя
 * `monthStartDay` (1–28): период с меткой `2026-07` при дне начала 2 идёт
 * со 2 июля по 1 августа включительно, то есть `[2026-07-02, 2026-08-02)`.
 * При дне 1 (значение по умолчанию) всё совпадает с календарным месяцем.
 *
 * Ограничение 28 — чтобы период существовал в феврале любого года.
 */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertPeriod(period: string): string {
  if (!PERIOD_RE.test(period)) {
    throw new ValidationError(`Некорректный период: ${period} (ожидается YYYY-MM)`);
  }
  return period;
}

export function assertMonthStartDay(day: number): number {
  if (!Number.isInteger(day) || day < MIN_MONTH_START_DAY || day > MAX_MONTH_START_DAY) {
    throw new ValidationError(
      `День начала месяца — целое от ${MIN_MONTH_START_DAY} до ${MAX_MONTH_START_DAY}`,
    );
  }
  return day;
}

/**
 * Период, которому принадлежит дата.
 * Даты раньше дня начала относятся к предыдущему по метке периоду.
 */
export function periodOf(date: Date, monthStartDay = 1): string {
  assertMonthStartDay(monthStartDay);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const shift = date.getUTCDate() < monthStartDay ? -1 : 0;
  const labelDate = new Date(Date.UTC(year, month + shift, 1));
  return `${labelDate.getUTCFullYear()}-${String(labelDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Полуинтервал [start, end) периода в UTC. */
export function periodRange(period: string, monthStartDay = 1): { start: Date; end: Date } {
  assertPeriod(period);
  assertMonthStartDay(monthStartDay);
  const [y, m] = period.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(y, m - 1, monthStartDay)),
    end: new Date(Date.UTC(y, m, monthStartDay)),
  };
}

/** Количество дней в периоде (зависит от длины месяцев на его границах). */
export function daysInPeriod(period: string, monthStartDay = 1): number {
  const { start, end } = periodRange(period, monthStartDay);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Порядковый номер дня внутри периода (0-based).
 * Заменяет наивное `date.getUTCDate() - 1`, которое верно только при дне начала 1.
 */
export function dayIndexInPeriod(date: Date, period: string, monthStartDay = 1): number {
  const { start } = periodRange(period, monthStartDay);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return Math.max(diff, 0);
}

/** Метка периода, идущего следом (для навигации по истории). */
export function shiftPeriod(period: string, delta: number): string {
  assertPeriod(period);
  const [y, m] = period.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
