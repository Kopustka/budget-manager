/** Валюты, доступные в настройках. Список общий для фронта и бэка. */

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'RUB', name: 'Российский рубль', symbol: '₽' },
  { code: 'USD', name: 'Доллар США', symbol: '$' },
  { code: 'EUR', name: 'Евро', symbol: '€' },
  { code: 'KZT', name: 'Казахстанский тенге', symbol: '₸' },
  { code: 'GEL', name: 'Грузинский лари', symbol: '₾' },
  { code: 'TRY', name: 'Турецкая лира', symbol: '₺' },
  { code: 'AMD', name: 'Армянский драм', symbol: '֏' },
] as const;

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: code };
}

/** Границы дня начала месяца: 29–31 не существуют в феврале, поэтому 28 — потолок. */
export const MIN_MONTH_START_DAY = 1;
export const MAX_MONTH_START_DAY = 28;
