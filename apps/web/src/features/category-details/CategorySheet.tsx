import type { Transaction } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { LimitBar } from '@/shared/ui/LimitBar';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { formatRelativeDay, formatTime } from '@/shared/lib/format';
import type { CategoryWithStats } from '@/entities/category/api';

interface CategorySheetProps {
  category: CategoryWithStats | null;
  transactions: Transaction[];
  onClose: () => void;
}

/** Детали категории: остаток лимита и последние операции по ней. */
export function CategorySheet({ category, transactions, onClose }: CategorySheetProps) {
  if (!category) return null;

  const spent = category.spent ?? 0;
  const rest = category.limit === null ? null : category.limit - spent;
  const items = transactions.filter((t) => t.categoryId === category.id).slice(0, 8);

  return (
    <BottomSheet
      open
      title={category.name}
      onClose={onClose}
      footer={
        <Button full onClick={onClose}>
          Понятно
        </Button>
      }
    >
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-hairline">
          <CategoryIcon name={category.icon} color={category.color} size={24} />
        </span>
        <div>
          <p className="text-sm text-ink-muted">Потрачено в этом месяце</p>
          <Money value={spent} className="text-2xl font-semibold" />
        </div>
      </div>

      {category.limit !== null ? (
        <div className="pb-4">
          <LimitBar spent={spent} limit={category.limit} />
          <p className="mt-2 text-sm text-ink-muted">
            {rest !== null && rest >= 0 ? (
              <>
                Остаток лимита: <Money value={rest} className="text-ink" />
              </>
            ) : (
              <>
                Перерасход:{' '}
                <Money value={Math.abs(rest ?? 0)} tone="negative" />
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="pb-4 text-sm text-ink-faint">Лимит на месяц не задан</p>
      )}

      <h3 className="pb-2 text-sm font-semibold text-ink-muted">Последние операции</h3>
      {items.length === 0 ? (
        <p className="pb-4 text-sm text-ink-faint">Пока пусто</p>
      ) : (
        <ul className="flex flex-col gap-1 pb-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-xl px-1 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate">{t.comment ?? t.subcategory ?? 'Без описания'}</span>
                <span className="text-xs text-ink-faint">
                  {formatRelativeDay(t.occurredAt)}, {formatTime(t.occurredAt)}
                </span>
              </span>
              <Money value={t.amount} tone={t.type === 'deposit' ? 'positive' : 'negative'} />
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
