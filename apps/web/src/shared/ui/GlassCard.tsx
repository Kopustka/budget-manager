import type { ReactNode } from 'react';
import { cn } from './cn';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  /** Лимит исчерпан или превышен — карточка «краснеет» без смены размеров. */
  danger?: boolean;
  /** Лимит на исходе (85–99%) — тёплое свечение, но ещё не тревога. */
  warning?: boolean;
  /** Активная цель перетаскивания. */
  highlighted?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * Базовая стеклянная поверхность. Состояния меняют только цвет/тень —
 * геометрия остаётся прежней, иначе при DnD плывёт соседний контент.
 *
 * Состояния взаимоисключающи и разобраны по убыванию важности:
 * danger → warning → highlighted. Состояние лимита перебивает подсветку цели
 * жеста намеренно: иначе карточка перестала бы предупреждать о перерасходе
 * ровно в тот момент, когда пользователь заносит над ней палец, чтобы списать
 * ещё раз. Что цель допустима, видно и без неё — недопустимые приглушены.
 */
export function GlassCard({
  children,
  className,
  danger = false,
  warning = false,
  highlighted = false,
  onClick,
  ariaLabel,
}: GlassCardProps) {
  const base = cn(
    'glass rounded-[var(--radius-card)] p-4',
    'transition-[background-color,border-color,box-shadow,transform] duration-[var(--duration-base)] ease-[var(--ease-ios)]',
    danger &&
      '[--glass-border:var(--color-danger)] bg-danger/30 shadow-[0_0_28px_-4px_var(--color-danger)]',
    warning &&
      !danger &&
      '[--glass-border:var(--color-warning)] bg-warning/12 shadow-[0_0_24px_-6px_var(--color-warning)]',
    highlighted &&
      !danger &&
      !warning &&
      '[--glass-border:var(--color-brand)] bg-brand/10 shadow-[0_0_28px_-4px_var(--color-brand)]',
    className,
  );

  if (!onClick) {
    return <div className={base}>{children}</div>;
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(base, 'w-full text-left active:opacity-80 active:scale-[0.99]')}
    >
      {children}
    </button>
  );
}
