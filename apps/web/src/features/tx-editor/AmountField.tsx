import { useEffect, useId } from 'react';
import { formatMoney } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { useNumpadStore } from '@/stores/useNumpadStore';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';

interface AmountFieldProps {
  /** Значение в мажорных единицах, как его вводит человек (строка — чтобы не терять «1,» при наборе). */
  value: string;
  onChange: (value: string) => void;
  /** Быстрые суммы под полем — экономят набор на типовых тратах. */
  quickAmounts?: number[];
  /** Заголовок над клавиатурой. */
  title?: string;
  /** Совместимость: раньше открывал системную клавиатуру, теперь ввод свой. */
  autoFocus?: boolean;
  error?: string | null;
}

const DEFAULT_QUICK = [100, 500, 1000, 5000];

/**
 * Ввод суммы через встроенную клавиатуру-калькулятор.
 *
 * Системную клавиатуру не используем: в Telegram Mini App нативное поле теряло
 * фокус после первой цифры. Поле — это витрина суммы; тап открывает экранную
 * клавиатуру (useNumpadStore), которая и принимает ввод, включая арифметику.
 */
export function AmountField({
  value,
  onChange,
  quickAmounts = DEFAULT_QUICK,
  title = 'Сумма',
  error,
}: AmountFieldProps) {
  const id = useId();
  const currency = useCurrency();
  const openFor = useNumpadStore((s) => s.openFor);
  const setOperand = useNumpadStore((s) => s.setOperand);
  const active = useNumpadStore((s) => s.open && s.fieldId === id);

  // Закрыли шторку, не закрыв клавиатуру, — уносим её вместе с полем, иначе
  // она осталась бы висеть поверх пустого экрана.
  useEffect(
    () => () => {
      const s = useNumpadStore.getState();
      if (s.fieldId === id) s.close();
    },
    [id],
  );

  const parsed = parseAmount(value);
  const display = parsed !== null ? formatMoney(parsed, currency) : '0';

  return (
    <div>
      <span className="block pb-1 text-sm text-ink-muted">{title}</span>
      <button
        type="button"
        id={id}
        aria-label={`${title}, изменить`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => {
          haptics.selection();
          openFor(id, { title, value, onChange });
        }}
        className={cn(
          'tabular w-full rounded-2xl bg-hairline px-4 py-3 text-left text-3xl font-semibold',
          'transition-colors duration-[var(--duration-fast)]',
          parsed === null && 'text-ink-faint',
          active && 'ring-2 ring-brand',
          error && 'ring-2 ring-danger',
        )}
      >
        {display}
      </button>
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
            onClick={() => {
              haptics.selection();
              // Клавиатура открыта для этого поля — подменяем операнд, чтобы её
              // выражение и поле сошлись; иначе просто пишем значение.
              if (active) setOperand(String(amount));
              else onChange(String(amount));
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

/** Разбор введённой строки в минорные единицы. null — ввод некорректен. */
export function parseAmount(input: string): number | null {
  const normalized = input.replace(',', '.').trim();
  if (!normalized) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 100);
}
