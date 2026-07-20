import { useId } from 'react';
import { currencyInfo } from '@budget/shared';
import { useCurrency } from '@/shared/lib/useCurrency';
import { formatMoney } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';

interface LimitFieldProps {
  /** Значение в мажорных единицах, как его вводит человек. Пустая строка — лимита нет. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

/** Типовые месячные бюджеты — чтобы не набирать четыре нуля вручную. */
const PRESETS = [5_000, 10_000, 30_000];

/**
 * Ввод запланированного месячного бюджета категории.
 *
 * Пустое поле — осознанное «без лимита», а не ошибка: планировать все категории
 * сразу никто не станет, и требовать сумму значило бы получить выдуманные числа.
 */
export function LimitField({ value, onChange, error }: LimitFieldProps) {
  const id = useId();
  const currency = useCurrency();
  const symbol = currencyInfo(currency).symbol;

  return (
    <div>
      <label htmlFor={id} className="block pb-1 text-sm text-ink-muted">
        Запланированный бюджет на месяц
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="без лимита"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={cn(
            'tabular w-full rounded-2xl bg-hairline py-3 pr-10 pl-4 text-xl font-semibold',
            'outline-none placeholder:text-base placeholder:font-normal placeholder:text-ink-faint',
            'transition-colors duration-[var(--duration-fast)]',
            error && 'ring-2 ring-danger',
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-ink-faint"
        >
          {symbol}
        </span>
      </div>

      {error ? (
        <p id={`${id}-error`} className="pt-1 text-sm text-danger">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="pt-2 text-xs text-ink-faint">
          Карточка категории покажет прогресс и предупредит, когда бюджет подойдёт к концу.
          Оставьте пустым — категория будет без лимита.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-3">
        {PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              haptics.selection();
              onChange(String(amount));
            }}
            className="min-h-11 rounded-full bg-hairline px-4 text-sm transition-colors duration-[var(--duration-fast)] active:bg-hairline-strong"
          >
            {formatMoney(amount * 100, currency)}
          </button>
        ))}
      </div>
    </div>
  );
}
