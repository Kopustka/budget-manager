import { formatMoney, formatMoneyCompact } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { cn } from './cn';

interface MoneyProps {
  /** Сумма в минорных единицах */
  value: number;
  /** По умолчанию — валюта из настроек пользователя. */
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
  currency,
  compact = false,
  tone = 'neutral',
  className,
}: MoneyProps) {
  const userCurrency = useCurrency();
  const code = currency ?? userCurrency;
  const text = compact ? formatMoneyCompact(value, code) : formatMoney(value, code);
  const prefix = tone === 'positive' ? '+' : tone === 'negative' ? '−' : '';
  return (
    <span className={cn('tabular', TONES[tone], className)}>
      {prefix}
      {text}
    </span>
  );
}
