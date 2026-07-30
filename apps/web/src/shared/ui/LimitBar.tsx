import { limitRatio, limitStatus, type LimitStatus } from '@budget/shared';
import { formatPercent } from '@/shared/lib/format';
import { cn } from './cn';

interface LimitBarProps {
  spent: number;
  limit: number;
  /** Статус из стора. Не передан — считаем по тем же порогам на месте. */
  status?: LimitStatus;
  /** Уплотнённый вид для плотной сетки карточек. */
  dense?: boolean;
  /** Подпись с процентом под полосой. На карточках выключена — там нужен только бар. */
  showText?: boolean;
}

/** Цвет заполнения по статусу: один и тот же язык на карточке и в шторке. */
const FILL: Record<LimitStatus, string> = {
  NONE: 'bg-brand',
  SAFE: 'bg-brand',
  WARNING: 'bg-warning',
  EXCEEDED: 'bg-danger',
};

const TEXT: Record<LimitStatus, string> = {
  NONE: 'text-ink-faint',
  SAFE: 'text-ink-faint',
  WARNING: 'text-warning',
  EXCEEDED: 'text-danger',
};

/**
 * Прогресс по лимиту категории. Статус передаётся не только цветом, но и
 * подписью с процентом — цвет в одиночку недоступен для дальтоников.
 */
export function LimitBar({ spent, limit, status, dense = false, showText = true }: LimitBarProps) {
  const state = status ?? limitStatus(spent, limit);
  const ratio = limitRatio(spent, limit) ?? 0;
  // Полоса упирается в 100%: перерасход показывает подпись, а не вылезшая
  // за пределы заливка — её всё равно нечем отрисовать.
  const filled = Math.min(ratio, 1);

  return (
    <div>
      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-hairline',
          dense ? 'h-1' : 'h-1.5',
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(filled * 100)}
        aria-label="Использовано от плана"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-[var(--duration-base)] ease-[var(--ease-ios)]',
            FILL[state],
          )}
          style={{ width: `${filled * 100}%` }}
        />
      </div>
      {/*
        Процент под полосой — только там, где полоса единственный показатель (шторка
        деталей). На карточках он выключен: там рядом стоят и факт, и план числами,
        и процент лишь дублировал бы их. Пометку о превышении оставляем — она несёт
        смысл, которого в числе нет, и дублирует красный цвет для тех, кто его не различает.
      */}
      {showText ? (
        <p className={cn('mt-1 tabular', dense ? 'text-[10px]' : 'text-xs', TEXT[state])}>
          {formatPercent(ratio)}
          {state === 'EXCEEDED' ? (ratio > 1 ? ' · превышен' : ' · исчерпан') : ''}
        </p>
      ) : null}
    </div>
  );
}
