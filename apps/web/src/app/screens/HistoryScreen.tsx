import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import type { HistoryTotals, Transaction, TransactionType } from '@budget/shared';
import { transactionApi } from '@/entities/transaction/api';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { Skeleton } from '@/shared/ui/Skeleton';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { formatRelativeDay, formatTime } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { transferLabel } from '@/shared/lib/transfer';
import { EditTransactionSheet } from '@/features/tx-editor/EditTransactionSheet';
import { cn } from '@/shared/ui/cn';

/** Подпись выбранного фильтра типа — рядом с кнопкой «Фильтры». */
const TYPE_FILTER_LABELS: Record<TransactionType, string> = {
  deposit: 'доходы',
  spend: 'расходы',
  transfer: 'переводы',
};

/**
 * Полная история операций: отрезок времени, фильтры и итоги.
 *
 * Отрезок по умолчанию — текущий расчётный период пользователя (он может
 * начинаться не с 1-го числа), поэтому границы берём из настроек, а не из
 * календаря.
 */
export function HistoryScreen() {
  const { categories, wallets, load } = useBudgetStore();
  const { periodStart, periodEnd, monthStartDay } = useSettingsStore();

  const historyFilter = useUiStore((s) => s.historyFilter);
  const setHistoryFilter = useUiStore((s) => s.setHistoryFilter);

  const [offset, setOffset] = useState(0);
  const [type, setType] = useState<TransactionType | 'all'>('all');
  // Пресет из шторки категории: экран открывается уже отфильтрованным.
  const [categoryId, setCategoryId] = useState<string | 'all'>(historyFilter?.categoryId ?? 'all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!historyFilter) return;
    setCategoryId(historyFilter.categoryId);
    setShowFilters(true);
    // Сбрасываем сразу: пресет одноразовый, иначе он вернётся при следующем
    // заходе на вкладку и пользователь не поймёт, почему список урезан.
    setHistoryFilter(null);
  }, [historyFilter, setHistoryFilter]);

  const [items, setItems] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState<HistoryTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);

  /** Границы выбранного отрезка: текущий период, сдвинутый на offset месяцев. */
  const range = useMemo(() => {
    const base = periodStart ? new Date(periodStart) : startOfPeriod(new Date(), monthStartDay);
    const start = new Date(base);
    start.setUTCMonth(start.getUTCMonth() + offset);
    const end = periodEnd ? new Date(periodEnd) : startOfPeriod(new Date(), monthStartDay);
    const finish = new Date(end);
    finish.setUTCMonth(finish.getUTCMonth() + offset);
    return { from: start, to: finish };
  }, [periodStart, periodEnd, monthStartDay, offset]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    transactionApi
      .history({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        type: type === 'all' ? undefined : type,
        categoryId: categoryId === 'all' ? undefined : categoryId,
      })
      .then((response) => {
        if (!alive) return;
        setItems(response.items);
        setTotals(response.totals ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить историю');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, type, categoryId]);

  /**
   * Лента группируется по дням: сплошной список за месяц читать невозможно.
   *
   * Дни без трат попадают в ленту отдельными строками, хотя операций в них нет:
   * весь смысл отметки в том, чтобы пустой день было видно. Границы берём по
   * реальным записям отрезка, а не по календарю, — иначе в ленту уехали бы дни,
   * когда приложением ещё не пользовались, и «серия» ничего не значила бы.
   */
  const byDay = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of items) {
      const key = tx.occurredAt.slice(0, 10);
      const list = groups.get(key);
      if (list) list.push(tx);
      else groups.set(key, [tx]);
    }
    if (groups.size === 0) return [] as Array<[string, Transaction[]]>;

    const keys = [...groups.keys()].sort();
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    // Начинаем с первой записи отрезка, а не с его начала: дни до неё человек
    // приложением не пользовался, и записывать их в достижения нечестно.
    const from = keys[0]!;
    // Конец — сегодня, но не дальше конца отрезка: у прошлых периодов будущего нет.
    const today = dayKey(new Date());
    const rangeEnd = dayKey(new Date(range.to.getTime() - 86_400_000));
    const last = today < rangeEnd ? today : rangeEnd;

    const filled: Array<[string, Transaction[]]> = [];
    for (
      let t = Date.parse(`${from}T00:00:00.000Z`);
      t <= Date.parse(`${last}T00:00:00.000Z`);
      t += 86_400_000
    ) {
      const key = dayKey(new Date(t));
      filled.push([key, groups.get(key) ?? []]);
    }
    // Свежее сверху — как было до появления пустых дней.
    return filled.reverse();
  }, [items, range.to]);

  const expenseCategories = categories.filter((c) => c.kind === 'expense');
  const rangeLabel = formatRange(range.from, range.to);

  return (
    <main className="mx-auto max-w-md px-4 pt-safe">
      <header className="pt-2 pb-4">
        <h1 className="text-sm text-ink-muted">История операций</h1>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            aria-label="Предыдущий период"
            onClick={() => {
              haptics.selection();
              setOffset((n) => n - 1);
            }}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-hairline"
          >
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <p className="flex-1 text-center text-lg font-semibold">{rangeLabel}</p>
          <button
            type="button"
            aria-label="Следующий период"
            disabled={offset >= 0}
            onClick={() => {
              haptics.selection();
              setOffset((n) => Math.min(n + 1, 0));
            }}
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-hairline',
              offset >= 0 && 'opacity-30',
            )}
          >
            <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Итоги считает сервер: по обрезанному списку они были бы неверны */}
      <div className="flex gap-2 pb-4">
        <GlassCard className="flex-1 py-3">
          <p className="text-xs text-ink-faint">Пришло</p>
          {totals ? (
            <Money value={totals.income} compact tone="positive" className="text-lg font-semibold" />
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </GlassCard>
        <GlassCard className="flex-1 py-3">
          <p className="text-xs text-ink-faint">Ушло</p>
          {totals ? (
            <Money value={totals.expense} compact tone="negative" className="text-lg font-semibold" />
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </GlassCard>
      </div>

      <button
        type="button"
        aria-expanded={showFilters}
        onClick={() => {
          haptics.selection();
          setShowFilters((v) => !v);
        }}
        className={cn(
          'mb-3 flex min-h-11 w-full items-center gap-2 rounded-2xl px-4 text-sm',
          'transition-colors duration-[var(--duration-fast)]',
          showFilters || type !== 'all' || categoryId !== 'all'
            ? 'bg-brand/15 text-brand'
            : 'bg-hairline text-ink-muted',
        )}
      >
        <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
        Фильтры
        {(type !== 'all' || categoryId !== 'all') && (
          <span className="ml-auto text-xs">
            {[type !== 'all' ? TYPE_FILTER_LABELS[type] : null,
              categoryId !== 'all'
                ? categories.find((c) => c.id === categoryId)?.name
                : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </button>

      {showFilters && (
        <div className="flex flex-col gap-3 pb-4">
          <div className="flex gap-1 rounded-2xl bg-hairline p-1">
            {(
              [
                ['all', 'Все'],
                ['deposit', 'Доходы'],
                ['spend', 'Расходы'],
                ['transfer', 'Переводы'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => {
                  haptics.selection();
                  setType(value);
                }}
                className={cn(
                  'min-h-11 flex-1 rounded-xl text-sm transition-colors duration-[var(--duration-fast)]',
                  type === value ? 'bg-elevated font-medium text-ink' : 'text-ink-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterChip
              active={categoryId === 'all'}
              onClick={() => setCategoryId('all')}
              label="Все категории"
            />
            {expenseCategories.map((c) => (
              <FilterChip
                key={c.id}
                active={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
                label={c.name}
                icon={<CategoryIcon name={c.icon} color={categoryId === c.id ? 'currentColor' : c.color} size={16} />}
              />
            ))}
          </div>
        </div>
      )}

      {error ? (
        <GlassCard>
          <p className="text-sm text-ink-muted">{error}</p>
        </GlassCard>
      ) : loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : items.length === 0 ? (
        <GlassCard>
          <p className="text-sm text-ink-muted">
            За выбранный период операций нет. Измените фильтры или период.
          </p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {byDay.map(([day, dayItems]) => {
            // День без трат: зачисления его не портят — важно, что деньги не уходили.
            const noSpend = dayItems.every((t) => t.type !== 'spend');
            return (
            <section key={day}>
              <div className="flex items-baseline justify-between pb-1">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                  {formatRelativeDay(`${day}T12:00:00.000Z`)}
                  {noSpend && (
                    <span className="flex items-center gap-1 text-warning" title="День без трат">
                      <Star size={12} strokeWidth={2.25} aria-hidden="true" />
                      <span className="font-normal">без трат</span>
                    </span>
                  )}
                </h2>
                {/* «0 опер.» читается как ошибка загрузки — у пустого дня счётчик молчит */}
                {dayItems.length > 0 ? (
                  <span className="text-xs text-ink-faint">{dayItems.length} опер.</span>
                ) : null}
              </div>
              <ul className="flex flex-col gap-2">
                {dayItems.map((t) => {
                  const isDeposit = t.type === 'deposit';
                  const isTransfer = t.type === 'transfer';
                  const Icon = isTransfer
                    ? ArrowLeftRight
                    : isDeposit
                      ? ArrowDownLeft
                      : ArrowUpRight;
                  const category = categories.find((c) => c.id === t.categoryId);
                  const kindLabel = isTransfer
                    ? 'перевод'
                    : isDeposit
                      ? 'зачисление'
                      : 'списание';
                  return (
                    <li key={t.id}>
                      <GlassCard
                        ariaLabel={`Операция ${kindLabel}, изменить`}
                        onClick={() => {
                          haptics.selection();
                          setEditing(t);
                        }}
                        className="flex items-center gap-3 py-3"
                      >
                        <span
                          className={cn(
                            'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                            isDeposit
                              ? 'bg-success/15 text-success'
                              : isTransfer
                                ? 'bg-brand/15 text-brand'
                                : 'bg-hairline text-ink-muted',
                          )}
                        >
                          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {isTransfer
                              ? transferLabel(t, wallets)
                              : t.comment ??
                                t.subcategory ??
                                category?.name ??
                                (isDeposit ? 'Зачисление' : 'Списание')}
                          </span>
                          <span className="text-xs text-ink-faint">
                            {formatTime(t.occurredAt)}
                            {isTransfer ? ' · перевод' : category ? ` · ${category.name}` : ''}
                          </span>
                        </span>
                        <Money
                          value={t.amount}
                          tone={isTransfer ? 'neutral' : isDeposit ? 'positive' : 'negative'}
                        />
                      </GlassCard>
                    </li>
                  );
                })}
              </ul>
            </section>
            );
          })}
        </div>
      )}

      <EditTransactionSheet
        transaction={editing}
        onClose={() => {
          setEditing(null);
          // Правка меняет суммы — обновляем и ленту, и главный стор.
          void load();
          setOffset((n) => n);
        }}
      />
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        haptics.selection();
        onClick();
      }}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-full px-4 text-sm',
        'transition-colors duration-[var(--duration-fast)]',
        active ? 'bg-brand text-brand-ink' : 'bg-hairline text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Начало расчётного периода для даты — запасной путь, пока настройки не загружены. */
function startOfPeriod(date: Date, monthStartDay: number): Date {
  const shift = date.getUTCDate() < monthStartDay ? -1 : 0;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + shift, monthStartDay));
}

const MONTH_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

/** «2 июл — 1 авг»: показываем именно границы периода, они могут не совпадать с месяцем. */
function formatRange(from: Date, to: Date): string {
  const last = new Date(to.getTime() - 86_400_000);
  return `${MONTH_FMT.format(from)} — ${MONTH_FMT.format(last)}`;
}
