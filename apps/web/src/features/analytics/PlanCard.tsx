import { limitRatio, limitStatus } from '@budget/shared';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { LimitBar } from '@/shared/ui/LimitBar';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import type { CategoryWithStats } from '@/entities/category/api';

/**
 * Соответствие плану расходов: факт против запланированного — общий и по каждой
 * категории с планом.
 *
 * Данные берутся из store (spent и limit за текущий период), поэтому карта живая:
 * после операции пересчитывается вместе с остальным. Категории без плана здесь не
 * показываем — сравнивать не с чем; их место в распределении, а не в этом виджете.
 */
export function PlanCard({ categories }: { categories: CategoryWithStats[] }) {
  const planned = categories
    .filter((c) => c.limit !== null)
    .map((c) => ({ ...c, spent: c.spent ?? 0, limit: c.limit as number }))
    // Самые «горящие» — вверх: перерасход и близкие к нему видно первыми.
    .sort((a, b) => (limitRatio(b.spent, b.limit) ?? 0) - (limitRatio(a.spent, a.limit) ?? 0));

  if (planned.length === 0) {
    return (
      <GlassCard>
        <p className="text-sm text-ink-muted">
          Планы расходов не заданы. Задайте план категории — и здесь будет видно,
          укладываетесь ли вы в него.
        </p>
      </GlassCard>
    );
  }

  const totalSpent = planned.reduce((sum, c) => sum + c.spent, 0);
  const totalPlan = planned.reduce((sum, c) => sum + c.limit, 0);
  const totalStatus = limitStatus(totalSpent, totalPlan);
  const rest = totalPlan - totalSpent;

  return (
    <GlassCard className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-muted">Потрачено из плана</span>
          <span className="tabular text-sm">
            <Money value={totalSpent} className="font-semibold" />
            <span className="text-ink-faint">
              {' / '}
              <Money value={totalPlan} className="text-ink-muted" />
            </span>
          </span>
        </div>
        <div className="pt-2">
          <LimitBar spent={totalSpent} limit={totalPlan} status={totalStatus} />
        </div>
        <p className="pt-1 text-xs text-ink-faint">
          {rest >= 0 ? (
            <>
              В плане ещё <Money value={rest} className="text-ink-muted" />
            </>
          ) : (
            <>
              Перерасход <Money value={-rest} tone="negative" />
            </>
          )}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {planned.map((c) => {
          const status = limitStatus(c.spent, c.limit);
          return (
            <li key={c.id}>
              <div className="flex items-center justify-between gap-2 pb-1">
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryIcon name={c.icon} color={c.color} size={16} />
                  <span className="truncate text-sm">{c.name}</span>
                </span>
                <span className="tabular shrink-0 text-sm">
                  <Money
                    value={c.spent}
                    compact
                    className={status === 'EXCEEDED' ? 'font-medium text-danger' : ''}
                  />
                  <span className="text-ink-faint">
                    {' / '}
                    <Money value={c.limit} compact className="text-ink-muted" />
                  </span>
                </span>
              </div>
              <LimitBar spent={c.spent} limit={c.limit} status={status} dense showText={false} />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
