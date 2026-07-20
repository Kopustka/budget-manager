import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import type { HistoryTotals, Transaction } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { LimitBar } from '@/shared/ui/LimitBar';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { Skeleton } from '@/shared/ui/Skeleton';
import { formatRelativeDay, formatTime } from '@/shared/lib/format';
import { transactionApi } from '@/entities/transaction/api';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import type { CategoryWithStats } from '@/entities/category/api';

interface CategorySheetProps {
  category: CategoryWithStats | null;
  onClose: () => void;
  /** Переход к правке названия, оформления и месячного плана. */
  onEdit: (category: CategoryWithStats) => void;
}

/** Сколько операций показываем в шторке, прежде чем увести в «Историю». */
const PAGE = 20;

/**
 * Детали категории: остаток лимита и её собственная история.
 *
 * Операции запрашиваем у сервера с фильтром по категории, а не фильтруем ленту
 * главного экрана: та содержит только последние записи, и в шторке пропадала бы
 * половина трат за период.
 */
export function CategorySheet({ category, onClose, onEdit }: CategorySheetProps) {
  const { periodStart, periodEnd } = useSettingsStore();
  const setTab = useUiStore((s) => s.setTab);
  const setHistoryFilter = useUiStore((s) => s.setHistoryFilter);

  const [items, setItems] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState<HistoryTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categoryId = category?.id ?? null;

  useEffect(() => {
    if (!categoryId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setItems([]);
    setTotals(null);
    transactionApi
      .history({
        categoryId,
        from: periodStart ?? undefined,
        to: periodEnd ?? undefined,
      })
      .then((response) => {
        if (!alive) return;
        setItems(response.items);
        setTotals(response.totals ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить операции');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [categoryId, periodStart, periodEnd]);

  /** Лента по дням: сплошной список за месяц читать невозможно. */
  const byDay = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of items.slice(0, PAGE)) {
      const key = tx.occurredAt.slice(0, 10);
      const list = groups.get(key);
      if (list) list.push(tx);
      else groups.set(key, [tx]);
    }
    return [...groups.entries()];
  }, [items]);

  if (!category) return null;

  const spent = category.spent ?? 0;
  const rest = category.limit === null ? null : category.limit - spent;

  function openFullHistory() {
    if (!category) return;
    haptics.selection();
    // Фильтр переезжает в «Историю» — там же правка, поиск по периодам и итоги.
    setHistoryFilter({ categoryId: category.id });
    setTab('history');
    onClose();
  }

  return (
    <BottomSheet
      open
      title={category.name}
      onClose={onClose}
      // Кнопки «Понятно» нет: она ничего не делала сверх крестика, тапа по
      // затемнению и Esc — только занимала место под единственным действием.
      footer={
        <Button
          full
          onClick={() => {
            haptics.selection();
            onEdit(category);
          }}
        >
          <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
          {category.limit === null ? 'Задать лимит' : 'Настроить'}
        </Button>
      }
    >
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-hairline">
          <CategoryIcon name={category.icon} color={category.color} size={24} />
        </span>
        <div>
          <p className="text-sm text-ink-muted">Потрачено за период</p>
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
                Перерасход: <Money value={Math.abs(rest ?? 0)} tone="negative" />
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="pb-4 text-sm text-ink-faint">Лимит на период не задан</p>
      )}

      <div className="flex items-baseline justify-between pb-2">
        <h3 className="text-sm font-semibold text-ink-muted">Операции по категории</h3>
        {totals ? <span className="text-xs text-ink-faint">{totals.count} за период</span> : null}
      </div>

      {error ? (
        <p className="pb-4 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="flex flex-col gap-2 pb-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="pb-4 text-sm text-ink-faint">За текущий период трат нет</p>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {byDay.map(([day, dayItems]) => (
            <section key={day}>
              <h4 className="pb-1 text-xs font-semibold text-ink-faint">
                {formatRelativeDay(`${day}T12:00:00.000Z`)}
              </h4>
              <ul className="flex flex-col gap-1">
                {dayItems.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-xl px-1 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {t.comment ?? t.subcategory ?? 'Без описания'}
                      </span>
                      <span className="text-xs text-ink-faint">{formatTime(t.occurredAt)}</span>
                    </span>
                    <Money value={t.amount} tone={t.type === 'deposit' ? 'positive' : 'negative'} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={openFullHistory}
        className="flex min-h-11 w-full items-center justify-center gap-1 text-sm text-brand"
      >
        {items.length > PAGE ? `Ещё ${items.length - PAGE} · вся история` : 'Вся история категории'}
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </BottomSheet>
  );
}
