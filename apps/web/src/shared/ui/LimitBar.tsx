import { formatPercent } from '@/shared/lib/format';
import { cn } from './cn';

interface LimitBarProps {
  spent: number;
  limit: number;
}

/**
 * Прогресс по лимиту категории. Статус передаётся не только цветом, но и
 * подписью с процентом — цвет в одиночку недоступен для дальтоников.
 */
export function LimitBar({ spent, limit }: LimitBarProps) {
  const ratio = limit > 0 ? spent / limit : 0;
  const over = ratio > 1;
  const near = !over && ratio >= 0.8;

  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-hairline"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
        aria-label="Использовано от лимита"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-[var(--duration-base)] ease-[var(--ease-ios)]',
            over ? 'bg-danger' : near ? 'bg-warning' : 'bg-brand',
          )}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <p
        className={cn(
          'mt-1 text-xs tabular',
          over ? 'text-danger' : near ? 'text-warning' : 'text-ink-faint',
        )}
      >
        {formatPercent(ratio)} лимита{over ? ' — превышен' : ''}
      </p>
    </div>
  );
}
