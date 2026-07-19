import { useEffect, useMemo, useState } from 'react';
import type { DistributionResponse, VelocityResponse } from '@budget/shared';
import { Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { analyticsApi } from '@/entities/analytics/api';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { Skeleton } from '@/shared/ui/Skeleton';
import { formatMoney, formatPercent } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { DonutChart, type DonutSlice } from '@/features/analytics/DonutChart';
import { VelocityChart } from '@/features/analytics/VelocityChart';
import { buildColorMap, CHART_REST, MAX_SLICES } from '@/features/analytics/chart-palette';
import { cn } from '@/shared/ui/cn';

/** Аналитика месяца: на что ушли деньги (donut) и с какой скоростью (velocity). */
export function AnalyticsScreen() {
  const categories = useBudgetStore((s) => s.categories);
  const [distribution, setDistribution] = useState<DistributionResponse | null>(null);
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([analyticsApi.distribution(), analyticsApi.velocity()])
      .then(([d, v]) => {
        if (!alive) return;
        setDistribution(d);
        setVelocity(v);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Не удалось загрузить аналитику');
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Цвет закреплён за категорией по порядку создания — рейтинг на него не влияет. */
  const colorMap = useMemo(
    () => buildColorMap(categories.filter((c) => c.kind === 'expense').map((c) => c.id)),
    [categories],
  );

  /**
   * Собираем сегменты доната. Свой цвет получают только категории со слотом;
   * всё остальное — и бесслотовый хвост, и лишнее сверх шести — сливается
   * в нейтральное «Другое». Так две категории не окажутся одного цвета.
   */
  const slices = useMemo<DonutSlice[]>(() => {
    const items = [...(distribution?.items ?? [])].sort((a, b) => b.spent - a.spent);
    const colored = items.filter((i) => colorMap.has(i.categoryId));
    const rest = items.filter((i) => !colorMap.has(i.categoryId));

    // Оставляем место под сегмент «Другое», если хвост не пуст.
    const headLimit = rest.length > 0 ? MAX_SLICES - 1 : MAX_SLICES;
    const head = colored.slice(0, headLimit);
    const tail = [...colored.slice(headLimit), ...rest];

    const slices: DonutSlice[] = head.map((i) => ({
      id: i.categoryId,
      name: i.name,
      value: i.spent,
      color: colorMap.get(i.categoryId) ?? CHART_REST,
      isOverdraft: i.isOverdraft,
    }));

    if (tail.length > 0) {
      slices.push({
        id: '__rest__',
        name: `Другое (${tail.length})`,
        value: tail.reduce((sum, i) => sum + i.spent, 0),
        color: CHART_REST,
      });
    }
    return slices;
  }, [distribution, colorMap]);

  /** Индекс сегодняшнего дня: факт рисуем только до него, а не до конца месяца. */
  const todayIndex = useMemo(() => {
    if (!velocity) return null;
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return velocity.period === currentPeriod ? now.getUTCDate() - 1 : null;
  }, [velocity]);

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 pt-safe">
        <p className="pt-8 text-center text-ink-muted">{error}</p>
      </main>
    );
  }

  const loading = !distribution || !velocity;
  const pace = velocity?.pace ?? 0;
  const overPace = pace > 0;

  return (
    <main className="mx-auto max-w-md px-4 pt-safe pb-safe">
      <header className="pt-2 pb-5">
        <p className="text-sm text-ink-muted">Потрачено за месяц</p>
        {loading ? (
          <Skeleton className="mt-1 h-10 w-40" />
        ) : (
          <Money value={distribution.total} className="text-4xl font-semibold tracking-tight" />
        )}
      </header>

      {/* Темп — это одно число, поэтому здесь плитка, а не ещё один график */}
      {!loading && velocity.budget !== null && (
        <GlassCard className="mb-6 flex items-center gap-3">
          <span
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
              overPace ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success',
            )}
          >
            {overPace ? (
              <TrendingUp size={22} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <TrendingDown size={22} strokeWidth={1.75} aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-snug">
              {overPace ? 'Тратите быстрее плана' : 'Укладываетесь в план'}
            </span>
            <span className="text-xs text-ink-faint">
              {overPace ? 'Опережение' : 'Запас'} к сегодняшнему дню
            </span>
          </span>
          {/* Величина отклонения — без знака: направление уже сказано словами и иконкой */}
          <Money
            value={Math.abs(pace)}
            compact
            className={cn('shrink-0 font-semibold', overPace ? 'text-danger' : 'text-success')}
          />
        </GlassCard>
      )}

      <section className="pb-6">
        <div className="flex items-center justify-between gap-2 pb-2">
          <h2 className="text-sm font-semibold text-ink-muted">Распределение</h2>
          {/* Табличный режим — обязательная альтернатива: доля сегмента на глаз читается плохо */}
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => {
              haptics.selection();
              setAsTable((v) => !v);
            }}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full px-3 text-xs',
              'transition-colors duration-[var(--duration-fast)]',
              asTable ? 'bg-brand text-brand-ink' : 'bg-hairline text-ink-muted',
            )}
          >
            <Table2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Таблицей
          </button>
        </div>

        <GlassCard>
          {loading ? (
            <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
          ) : asTable ? (
            <DistributionTable items={slices} total={distribution.total} />
          ) : (
            <DonutChart slices={slices} total={distribution.total} />
          )}
        </GlassCard>
      </section>

      <section className="pb-6">
        <div className="pb-2">
          <h2 className="text-sm font-semibold text-ink-muted">Скорость трат</h2>
          <p className="text-[11px] text-ink-faint">
            Факт нарастающим итогом против равномерного расхода бюджета
          </p>
        </div>
        <GlassCard>
          {loading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
            <VelocityChart
              points={velocity.points}
              budget={velocity.budget}
              todayIndex={todayIndex}
            />
          )}
        </GlassCard>
      </section>
    </main>
  );
}

/** Тот же набор данных числами: доступен скринридеру и снимает вопрос «сколько точно». */
function DistributionTable({ items, total }: { items: DonutSlice[]; total: number }) {
  if (total <= 0) {
    return <p className="py-6 text-center text-sm text-ink-faint">Трат за месяц нет</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Распределение трат по категориям за месяц</caption>
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th scope="col" className="pb-2 font-medium">
              Категория
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Сумма
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Доля
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-hairline">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: item.color }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
              </th>
              <td className="tabular py-2 text-right">{formatMoney(item.value)}</td>
              <td className="tabular py-2 text-right text-ink-muted">
                {formatPercent(item.value / total)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline-strong font-medium">
            <th scope="row" className="py-2 text-left">
              Итого
            </th>
            <td className="tabular py-2 text-right">{formatMoney(total)}</td>
            <td className="tabular py-2 text-right text-ink-muted">100 %</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
