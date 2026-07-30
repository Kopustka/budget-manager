import { useEffect, type ReactNode } from 'react';
import { Delete, Check } from 'lucide-react';
import { useNumpadStore, expressionOf } from '@/stores/useNumpadStore';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';

/**
 * Экранная клавиатура-калькулятор, общая на всё приложение.
 *
 * Смонтирована один раз в корне: любое поле суммы открывает её через
 * useNumpadStore и получает ввод обратно колбэком. Док снизу поверх шторки —
 * так же, как вставала бы системная клавиатура, которую она заменяет.
 */
export function Numpad() {
  const open = useNumpadStore((s) => s.open);
  const title = useNumpadStore((s) => s.title);
  const calc = useNumpadStore((s) => s.calc);
  const store = useNumpadStore;

  // Физическая клавиатура — для десктопа и скринридера. В capture-фазе, чтобы
  // Escape закрыл панель, а не шторку (у BottomSheet свой слушатель на document).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const s = store.getState();
      if (e.key >= '0' && e.key <= '9') s.digit(e.key);
      else if (e.key === '.' || e.key === ',') s.decimal();
      else if (e.key === '+' || e.key === '-') s.operator(e.key);
      else if (e.key === '*') s.operator('*');
      else if (e.key === '/') s.operator('/');
      else if (e.key === 'Enter' || e.key === '=') s.equals();
      else if (e.key === 'Backspace') s.backspace();
      else if (e.key === 'Escape') s.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, store]);

  if (!open) return null;

  const s = store.getState();
  const tap = (fn: () => void) => () => {
    haptics.selection();
    fn();
  };

  return (
    <div
      // Не dialog и без скрима: это клавиатура, а не отдельная шторка. Поле суммы
      // над ней остаётся видимым и активным.
      className={cn(
        'fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-md',
        'rounded-t-[var(--radius-sheet)] border-t border-hairline-strong bg-elevated',
        'animate-[sheet-in_var(--duration-base)_var(--ease-ios)] px-3 pt-2 pb-safe',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <span className="text-xs text-ink-faint">{title}</span>
        {/* Выражение калькулятора: видно, что «500 × 3» ещё не свёрнуто в результат */}
        <span className="tabular truncate text-lg font-semibold" aria-live="polite">
          {expressionOf(calc)}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <Key label="Очистить" onClick={tap(s.clear)} tone="muted">
          C
        </Key>
        <Key label="Стереть" onClick={tap(s.backspace)} tone="muted">
          <Delete size={20} strokeWidth={1.75} aria-hidden="true" />
        </Key>
        <Key label="Разделить" onClick={tap(() => s.operator('/'))} tone="op">
          ÷
        </Key>
        <Key label="Умножить" onClick={tap(() => s.operator('*'))} tone="op">
          ×
        </Key>

        <Key label="7" onClick={tap(() => s.digit('7'))}>7</Key>
        <Key label="8" onClick={tap(() => s.digit('8'))}>8</Key>
        <Key label="9" onClick={tap(() => s.digit('9'))}>9</Key>
        <Key label="Минус" onClick={tap(() => s.operator('-'))} tone="op">−</Key>

        <Key label="4" onClick={tap(() => s.digit('4'))}>4</Key>
        <Key label="5" onClick={tap(() => s.digit('5'))}>5</Key>
        <Key label="6" onClick={tap(() => s.digit('6'))}>6</Key>
        <Key label="Плюс" onClick={tap(() => s.operator('+'))} tone="op">+</Key>

        <Key label="1" onClick={tap(() => s.digit('1'))}>1</Key>
        <Key label="2" onClick={tap(() => s.digit('2'))}>2</Key>
        <Key label="3" onClick={tap(() => s.digit('3'))}>3</Key>
        <Key label="Равно" onClick={tap(s.equals)} tone="op">=</Key>

        <Key label="0" onClick={tap(() => s.digit('0'))} className="col-span-2">0</Key>
        <Key label="Запятая" onClick={tap(s.decimal)}>,</Key>
        <Key label="Готово" onClick={tap(s.close)} tone="done">
          <Check size={20} strokeWidth={2.25} aria-hidden="true" />
        </Key>
      </div>
    </div>
  );
}

/** Клавиша: крупная цель нажатия, вариант по роли (цифра / оператор / действие). */
function Key({
  label,
  onClick,
  children,
  tone = 'digit',
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  tone?: 'digit' | 'op' | 'muted' | 'done';
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid min-h-14 place-items-center rounded-2xl text-2xl font-semibold',
        'transition-colors duration-[var(--duration-fast)] active:brightness-95',
        tone === 'digit' && 'bg-hairline active:bg-hairline-strong',
        tone === 'muted' && 'bg-hairline text-ink-muted active:bg-hairline-strong',
        tone === 'op' && 'bg-brand/15 text-brand active:bg-brand/25',
        tone === 'done' && 'bg-brand text-brand-ink active:brightness-110',
        className,
      )}
    >
      {children}
    </button>
  );
}
