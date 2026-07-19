import { useId } from 'react';
import { formatMoney } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { cn } from '@/shared/ui/cn';

interface AmountFieldProps {
  /** Значение в мажорных единицах, как его вводит человек (строка — чтобы не терять «1,» при наборе). */
  value: string;
  onChange: (value: string) => void;
  /** Быстрые суммы под полем — экономят набор на типовых тратах. */
  quickAmounts?: number[];
  autoFocus?: boolean;
  error?: string | null;
}

const DEFAULT_QUICK = [100, 500, 1000, 5000];

/** Ввод суммы: видимая подпись, числовая клавиатура, ошибка рядом с полем. */
export function AmountField({
  value,
  onChange,
  quickAmounts = DEFAULT_QUICK,
  autoFocus = false,
  error,
}: AmountFieldProps) {
  const id = useId();
  const currency = useCurrency();

  return (
    <div>
      <label htmlFor={id} className="block pb-1 text-sm text-ink-muted">
        Сумма
      </label>
      <input
        id={id}
        // inputMode=decimal открывает числовую клавиатуру, но не ломает запятую
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        placeholder="0"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          'tabular w-full rounded-2xl bg-hairline px-4 py-3 text-3xl font-semibold',
          'outline-none placeholder:text-ink-faint',
          'transition-colors duration-[var(--duration-fast)]',
          error && 'ring-2 ring-danger',
        )}
      />
      {error ? (
        <p id={`${id}-error`} className="pt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-3">
        {quickAmounts.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onChange(String(amount))}
            className="min-h-11 rounded-full bg-hairline px-4 text-sm transition-colors duration-[var(--duration-fast)] active:bg-hairline-strong"
          >
            {formatMoney(amount * 100, currency)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Разбор введённой строки в минорные единицы. null — ввод некорректен. */
export function parseAmount(input: string): number | null {
  const normalized = input.replace(',', '.').trim();
  if (!normalized) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 100);
}
