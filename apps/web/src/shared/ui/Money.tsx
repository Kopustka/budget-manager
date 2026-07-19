import { formatMoney, formatMoneyCompact } from '@/shared/lib/format';
import { cn } from './cn';

interface MoneyProps {
  /** Сумма в минорных единицах */
  value: number;
  currency?: string;
  compact?: boolean;
  /** Подсветить знак: доход зелёным, расход красным */
  tone?: 'neutral' | 'positive' | 'negative';
  className?: string;
}

const TONES = {
  neutral: '',
  positive: 'text-success',
  negative: 'text-danger',
} as const;

/** Денежная сумма моноширинными цифрами — при пересчёте не «дрожит». */
export function Money({
  value,
  currency = 'RUB',
  compact = false,
  tone = 'neutral',
  className,
}: MoneyProps) {
  const text = compact ? formatMoneyCompact(value, currency) : formatMoney(value, currency);
  const prefix = tone === 'positive' ? '+' : tone === 'negative' ? '−' : '';
  return (
    <span className={cn('tabular', TONES[tone], className)}>
      {prefix}
      {text}
    </span>
  );
}
