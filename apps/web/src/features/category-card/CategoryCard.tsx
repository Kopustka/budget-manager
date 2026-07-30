import { GlassCard } from '@/shared/ui/GlassCard';
import { LimitBar } from '@/shared/ui/LimitBar';
import { Money } from '@/shared/ui/Money';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { DropNode } from '@/features/dnd-matrix/dnd-nodes';
import { useCategoryBudget } from '@/stores/useBudgetStore';
import { haptics } from '@/shared/lib/telegram';
import type { CategoryWithStats } from '@/entities/category/api';

interface CategoryCardProps {
  category: CategoryWithStats;
  onOpen: (category: CategoryWithStats) => void;
}

/** Подпись статуса для скринридера: цвет карточки ему недоступен. */
const STATUS_LABEL = {
  NONE: '',
  SAFE: '',
  WARNING: ', план на исходе',
  EXCEEDED: ', план исчерпан',
} as const;

/**
 * Карточка категории расхода: цель перетаскивания из кошелька и прогресс по
 * плану расходов.
 *
 * План и факт компонент не получает пропсами, а берёт из стора селектором:
 * после Drag-and-Drop обновляется одно число spent, и перекрашивается ровно эта
 * карточка — соседние по странице не перерисовываются.
 *
 * На карточке видны сразу и факт (крупно), и план (справа снизу), а прогресс —
 * только полосой без процента: точную сумму плана теперь не нужно искать в шторке.
 */
export function CategoryCard({ category, onOpen }: CategoryCardProps) {
  const { spent, limit, status } = useCategoryBudget(category.id);

  return (
    <DropNode kind="expense" id={category.id} className="h-full">
      {({ isOver, isAllowed }) => (
        <GlassCard
          dense
          danger={status === 'EXCEEDED'}
          warning={status === 'WARNING'}
          highlighted={isOver && isAllowed}
          ariaLabel={
            `Категория ${category.name}${STATUS_LABEL[status]}, потрачено` +
            `${limit !== null ? ' из плана' : ''}, подробности`
          }
          onClick={() => {
            haptics.selection();
            onOpen(category);
          }}
          className="flex h-full flex-col gap-1.5"
        >
          <div className="flex items-center gap-1.5">
            <CategoryIcon name={category.icon} color={category.color} size={14} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{category.name}</span>
          </div>

          <Money value={spent} compact className="text-sm font-semibold" />

          {/* mt-auto прижимает прогресс к низу — карточки в сетке выглядят выровненными */}
          <div className="mt-auto">
            {limit !== null ? (
              <>
                <LimitBar spent={spent} limit={limit} status={status} dense showText={false} />
                <p className="tabular pt-1 text-right text-[10px] text-ink-faint">
                  план <Money value={limit} compact className="text-ink-muted" />
                </p>
              </>
            ) : (
              <p className="text-[10px] text-ink-faint">Без плана</p>
            )}
          </div>
        </GlassCard>
      )}
    </DropNode>
  );
}
