import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink active:bg-brand/85',
  secondary: 'bg-hairline text-ink active:bg-hairline-strong',
  danger: 'bg-danger text-brand-ink active:bg-danger/85',
  ghost: 'bg-transparent text-ink-muted active:bg-hairline',
};

/** Кнопка с гарантированной тач-целью 44px и заметным disabled-состоянием. */
export function Button({
  variant = 'primary',
  full = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5',
        'font-semibold transition-[background-color,opacity] duration-[var(--duration-fast)]',
        VARIANTS[variant],
        full && 'w-full',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
