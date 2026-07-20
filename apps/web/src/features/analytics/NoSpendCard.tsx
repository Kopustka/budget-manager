import { useMemo } from 'react';
import { Star } from 'lucide-react';
import type { NoSpendResponse } from '@budget/shared';
import { GlassCard } from '@/shared/ui/GlassCard';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/shared/ui/cn';

/** Склонение дней для подписи серии. */
function plural(days: number): string {
  const n = Math.abs(days) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

/**
 * Дни без трат за период: серия и полоса дней с отметками.
 *
 * Полоса рисуется на весь период, а не только по прожитым дням: так видно и
 * сколько ещё возможностей осталось, а не только уже собранное.
 */
export function NoSpendCard({ data }: { data: NoSpendResponse }) {
  const periodStart = useSettingsStore((s) => s.periodStart);
  const periodEnd = useSettingsStore((s) => s.periodEnd);

  const noSpend = useMemo(() => new Set(data.days), [data.days]);

  const days = useMemo(() => {
    if (!periodStart || !periodEnd) return [];
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const todayKey = new Date().toISOString().slice(0, 10);
    const result: Array<{ key: string; clean: boolean; future: boolean; today: boolean }> = [];
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) {
      const key = new Date(t).toISOString().slice(0, 10);
      result.push({
        key,
        clean: noSpend.has(key),
        future: key > todayKey,
        today: key === todayKey,
      });
    }
    return result;
  }, [periodStart, periodEnd, noSpend]);

  return (
    <GlassCard>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-warning/15 text-warning">
          <Star size={22} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {data.currentStreak > 0
              ? `Серия: ${data.currentStreak} ${plural(data.currentStreak)} без трат`
              : 'Серия прервана'}
          </p>
          <p className="text-xs text-ink-faint">
            Всего за период: {data.total} · лучшая серия: {data.bestStreak}
          </p>
        </div>
      </div>

      {days.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-3" aria-hidden="true">
          {days.map((d) => (
            <span
              key={d.key}
              title={d.key}
              className={cn(
                'h-2.5 w-2.5 rounded-full transition-colors duration-[var(--duration-fast)]',
                d.future
                  ? 'bg-hairline'
                  : d.clean
                    ? 'bg-warning'
                    : 'bg-hairline-strong',
                d.today && 'ring-1 ring-ink ring-offset-2 ring-offset-surface',
              )}
            />
          ))}
        </div>
      )}
      {/* Полоса — картинка; для скринридера тот же смысл словами выше */}
      <p className="pt-2 text-[11px] text-ink-faint">
        Отмечены дни, когда не потрачено ни рубля. Зачисления день не портят.
      </p>
    </GlassCard>
  );
}
