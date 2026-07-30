import { CalendarClock, Flame, TrendingDown } from 'lucide-react';
import type { ForecastResponse, ForecastVerdict } from '@budget/shared';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { useCurrency } from '@/shared/lib/useCurrency';
import { formatMoney } from '@/shared/lib/format';
import { cn } from '@/shared/ui/cn';

/** Склонение дней: «12 дней», «2 дня», «1 день». */
function plural(days: number): string {
  const n = Math.abs(days) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

const TONE: Record<ForecastVerdict, string> = {
  ON_TRACK: 'text-success',
  TIGHT: 'text-warning',
  SHORTFALL: 'text-danger',
  NO_BUDGET: 'text-ink-faint',
  NO_SPEND: 'text-ink-faint',
};

/**
 * Прогноз исчерпания бюджета по среднему темпу трат.
 *
 * Когда прогнозировать не от чего (нет лимитов или нет трат), говорим об этом
 * прямо, а не подставляем правдоподобное число: выдуманный срок хуже его отсутствия.
 */
export function ForecastCard({ forecast }: { forecast: ForecastResponse }) {
  const currency = useCurrency();
  const { verdict, dailyBurn, daysLeftAtBurn, daysLeftInPeriod, remaining, windowDays } = forecast;

  const headline = (() => {
    switch (verdict) {
      case 'NO_BUDGET':
        return 'Прогноза пока нет';
      case 'NO_SPEND':
        return 'Трат за неделю не было';
      case 'SHORTFALL':
        return `Бюджет закончится через ${daysLeftAtBurn} ${plural(daysLeftAtBurn ?? 0)}`;
      case 'TIGHT':
        return 'Бюджета хватит впритык';
      case 'ON_TRACK':
        return 'Бюджета хватит до конца периода';
    }
  })();

  const detail = (() => {
    switch (verdict) {
      case 'NO_BUDGET':
        return 'Задайте планы категориям — без них сравнивать темп не с чем.';
      case 'NO_SPEND':
        return 'Средний темп нулевой, поэтому срок посчитать нельзя.';
      case 'SHORTFALL':
        return `А в периоде остаётся ещё ${daysLeftInPeriod} ${plural(daysLeftInPeriod)}.`;
      default:
        return daysLeftAtBurn === null
          ? ''
          : `Хватит на ${daysLeftAtBurn} ${plural(daysLeftAtBurn)} при остатке ${formatMoney(remaining ?? 0, currency)}.`;
    }
  })();

  const Icon = verdict === 'SHORTFALL' ? Flame : verdict === 'TIGHT' ? TrendingDown : CalendarClock;

  return (
    <GlassCard
      danger={verdict === 'SHORTFALL'}
      warning={verdict === 'TIGHT'}
      className="flex items-start gap-3"
    >
      <span className={cn('mt-0.5 shrink-0', TONE[verdict])}>
        <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold leading-snug', TONE[verdict])}>{headline}</p>
        {detail ? <p className="pt-0.5 text-xs text-ink-faint">{detail}</p> : null}

        {dailyBurn > 0 && (
          <p className="pt-2 text-xs text-ink-muted">
            Темп: <Money value={dailyBurn} className="text-ink" /> в день
            {/* Окно короче недели у новых профилей — честнее сказать, по скольким
                дням посчитано, чем молча выдать «среднее за неделю» по двум дням */}
            <span className="text-ink-faint">
              {' · '}
              по {windowDays} {plural(windowDays)}
            </span>
          </p>
        )}
      </div>
    </GlassCard>
  );
}
