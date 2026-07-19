import type { ReactNode } from 'react';
import { cn } from './cn';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  /** Состояние овердрафта — карточка «краснеет» без смены размеров. */
  danger?: boolean;
  /** Активная цель перетаскивания. */
  highlighted?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * Базовая стеклянная поверхность. Состояния меняют только цвет/тень —
 * геометрия остаётся прежней, иначе при DnD плывёт соседний контент.
 */
export function GlassCard({
  children,
  className,
  danger = false,
  highlighted = false,
  onClick,
  ariaLabel,
}: GlassCardProps) {
  const base = cn(
    'glass rounded-[var(--radius-card)] p-4',
    'transition-[background-color,border-color,box-shadow,transform] duration-[var(--duration-base)] ease-[var(--ease-ios)]',
    danger && 'border-danger/60 bg-danger/12 shadow-[0_0_24px_-6px_var(--color-danger)]',
    highlighted && !danger && 'border-brand/70 shadow-[0_0_24px_-6px_var(--color-brand)]',
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
