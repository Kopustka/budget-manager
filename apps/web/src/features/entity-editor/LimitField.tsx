import { useEffect, useId } from 'react';
import { useCurrency } from '@/shared/lib/useCurrency';
import { formatMoney } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { useNumpadStore } from '@/stores/useNumpadStore';
import { parseAmount } from '@/features/tx-editor/AmountField';
import { cn } from '@/shared/ui/cn';

interface LimitFieldProps {
  /** Значение в мажорных единицах, как его вводит человек. Пустая строка — лимита нет. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

/** Типовые месячные планы — чтобы не набирать четыре нуля вручную. */
const PRESETS = [5_000, 10_000, 30_000];
const TITLE = 'План расходов';

/**
 * Ввод плана расходов категории на месяц через встроенную клавиатуру.
 *
 * Пустое поле — осознанное «без плана», а не ошибка: планировать все категории
 * сразу никто не станет, и требовать сумму значило бы получить выдуманные числа.
 * Очистка клавиатуры (C или стирание) как раз и возвращает поле в это состояние.
 */
export function LimitField({ value, onChange, error }: LimitFieldProps) {
  const id = useId();
  const currency = useCurrency();
  const openFor = useNumpadStore((s) => s.openFor);
  const setOperand = useNumpadStore((s) => s.setOperand);
  const active = useNumpadStore((s) => s.open && s.fieldId === id);

  useEffect(
    () => () => {
      const s = useNumpadStore.getState();
      if (s.fieldId === id) s.close();
    },
    [id],
  );

  const parsed = parseAmount(value);
  const display = parsed !== null ? formatMoney(parsed, currency) : 'без плана';

  return (
    <div>
      <span className="block pb-1 text-sm text-ink-muted">План расходов на месяц</span>
      <button
        type="button"
        id={id}
        aria-label={`${TITLE}, изменить`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onClick={() => {
          haptics.selection();
          openFor(id, { title: TITLE, value, onChange });
        }}
        className={cn(
          'tabular w-full rounded-2xl bg-hairline px-4 py-3 text-left text-xl font-semibold',
          'transition-colors duration-[var(--duration-fast)]',
          parsed === null && 'text-base font-normal text-ink-faint',
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
      ) : (
        <p id={`${id}-hint`} className="pt-2 text-xs text-ink-faint">
          Карточка категории покажет прогресс и предупредит, когда план будет на исходе.
          Оставьте пустым — категория будет без плана.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-3">
        {PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              haptics.selection();
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
