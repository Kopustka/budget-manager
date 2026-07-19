import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, WalletMinimal } from 'lucide-react';
import type { Transaction } from '@budget/shared';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { LimitBar } from '@/shared/ui/LimitBar';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { Skeleton, SkeletonCard } from '@/shared/ui/Skeleton';
import { Button } from '@/shared/ui/Button';
import { formatRelativeDay, formatTime } from '@/shared/lib/format';
import { haptics, isInsideTelegram } from '@/shared/lib/telegram';
import { CategorySheet } from '@/features/category-details/CategorySheet';
import { DragNode, DropNode } from '@/features/dnd-matrix/dnd-nodes';
import { TimeCarousel, localDayKey } from '@/features/time-carousel/TimeCarousel';
import { CategoryPager } from '@/features/category-pager/CategoryPager';
import { OperationSheet } from '@/features/tx-editor/OperationSheet';
import { EditTransactionSheet } from '@/features/tx-editor/EditTransactionSheet';
import { QuickAddSheet } from '@/features/tx-editor/QuickAddSheet';
import type { CategoryWithStats } from '@/entities/category/api';
import { cn } from '@/shared/ui/cn';

/**
 * Главный экран: карусель времени, матрица Доход → Кошелёк → Расход,
 * лента операций за выбранный день и правка через шторку.
 */
export function HomeScreen() {
  const { wallets, categories, transactions, loading, error, load } = useBudgetStore();
  const selectedDay = useUiStore((s) => s.selectedDay);

  const [openCategory, setOpenCategory] = useState<CategoryWithStats | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);

  const totalBalance = useMemo(
    () => wallets.reduce((sum, w) => sum + w.balance, 0),
    [wallets],
  );
  const expenses = categories.filter((c) => c.kind === 'expense');
  const incomes = categories.filter((c) => c.kind === 'income');

  // ru-locale добавляет «г.» — для заголовка это лишний шум, собираем метку сами.
  const monthLabel = useMemo(() => {
    const now = new Date();
    const month = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(now);
    return `${month[0]?.toUpperCase()}${month.slice(1)} ${now.getFullYear()}`;
  }, []);

  /** Итоги текущего месяца — контекст к балансу: сколько пришло и сколько ушло. */
  const monthTotals = useMemo(() => {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return transactions.reduce(
      (acc, t) => {
        if (new Date(t.occurredAt) < from) return acc;
        if (t.type === 'deposit') acc.income += t.amount;
        else acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [transactions]);

  /** Лента показывает выбранный в карусели день. */
  const dayTransactions = useMemo(
    () => transactions.filter((t) => localDayKey(new Date(t.occurredAt)) === selectedDay),
    [transactions, selectedDay],
  );

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-ink-muted">{error}</p>
        <Button
          onClick={() => {
            haptics.impact();
            void load();
          }}
        >
          <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
          Повторить
        </Button>
        {!isInsideTelegram() && (
          <p className="max-w-xs text-xs text-ink-faint">
            Приложение открыто вне Telegram. Для локальной разработки положите подписанный
            initData в <code>apps/web/.env.local</code> как <code>VITE_DEV_INIT_DATA</code>.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-safe pb-safe">
      {/* Баланс — главный объект экрана, поэтому он крупнее всего остального */}
      <header className="pt-2 pb-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-ink-muted">Общий баланс</p>
          <p className="text-xs tracking-wide text-ink-faint">{monthLabel}</p>
        </div>
        {loading && wallets.length === 0 ? (
          <Skeleton className="mt-1 h-10 w-48" />
        ) : (
          <Money value={totalBalance} className="text-4xl font-semibold tracking-tight" />
        )}
        <div className="mt-3 flex gap-2">
          <SummaryChip tone="positive" label="Доход" value={monthTotals.income} />
          <SummaryChip tone="negative" label="Расход" value={monthTotals.expense} />
        </div>
      </header>

      <TimeCarousel transactions={transactions} onQuickAdd={() => setQuickAdd(true)} />

      <Section title="Источники дохода" hint="Потяните в кошелёк, чтобы зачислить">
        <div className="flex flex-wrap gap-2">
          {incomes.map((c) => (
            <DragNode key={c.id} kind="income" id={c.id} label={`Доход: ${c.name}`}>
              <span className="glass flex min-h-11 cursor-grab items-center gap-2 rounded-full px-4 text-sm active:cursor-grabbing">
                <CategoryIcon name={c.icon} color={c.color ?? 'var(--color-success)'} size={18} />
                {c.name}
              </span>
            </DragNode>
          ))}
        </div>
      </Section>

      <Section title="Кошельки" hint="Цель зачисления и источник трат">
        {loading && wallets.length === 0 ? (
          <SkeletonCard />
        ) : (
          <div className="flex flex-col gap-3">
            {wallets.map((w) => (
              <DropNode key={w.id} kind="wallet" id={w.id}>
                {({ isOver, isAllowed }) => (
                  <DragNode kind="wallet" id={w.id} label={`Кошелёк: ${w.name}`}>
                    <GlassCard
                      highlighted={isOver && isAllowed}
                      className="flex cursor-grab items-center gap-3 active:cursor-grabbing"
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand">
                        <WalletMinimal size={22} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{w.name}</span>
                        <span className="text-xs text-ink-faint">{w.currency}</span>
                      </span>
                      <Money value={w.balance} className="text-lg font-semibold" />
                    </GlassCard>
                  </DragNode>
                )}
              </DropNode>
            ))}
          </div>
        )}
      </Section>

      <Section title="Категории расходов" hint="Бросьте кошелёк на категорию, чтобы списать">
        {loading && expenses.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <CategoryPager
            items={expenses}
            keyOf={(c) => c.id}
            renderItem={(c) => (
              <DropNode kind="expense" id={c.id} className="h-full">
                {({ isOver, isAllowed }) => (
                  <GlassCard
                    danger={c.isOverdraft}
                    highlighted={isOver && isAllowed}
                    ariaLabel={`Категория ${c.name}, подробности`}
                    onClick={() => {
                      haptics.selection();
                      setOpenCategory(c);
                    }}
                    className="flex h-full flex-col gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <CategoryIcon name={c.icon} color={c.color} size={20} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                    </div>
                    <Money value={c.spent ?? 0} compact className="text-xl font-semibold" />
                    {/* mt-auto прижимает прогресс к низу — карточки в сетке выглядят выровненными */}
                    <div className="mt-auto">
                      {c.limit !== null ? (
                        <LimitBar spent={c.spent ?? 0} limit={c.limit} />
                      ) : (
                        <p className="text-xs text-ink-faint">Без лимита</p>
                      )}
                    </div>
                  </GlassCard>
                )}
              </DropNode>
            )}
          />
        )}
      </Section>

      <Section title={`Операции · ${formatRelativeDay(`${selectedDay}T12:00:00.000Z`)}`}>
        {loading && transactions.length === 0 ? (
          <SkeletonCard />
        ) : dayTransactions.length === 0 ? (
          <GlassCard>
            <p className="text-sm text-ink-muted">
              За этот день операций нет. Перетащите доход в кошелёк или нажмите «+».
            </p>
          </GlassCard>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayTransactions.map((t) => {
              const isDeposit = t.type === 'deposit';
              const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight;
              return (
                <li key={t.id}>
                  <GlassCard
                    ariaLabel={`Операция ${isDeposit ? 'зачисление' : 'списание'}, изменить`}
                    onClick={() => {
                      haptics.selection();
                      setEditing(t);
                    }}
                    className="flex items-center gap-3 py-3"
                  >
                    <span
                      className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                        isDeposit ? 'bg-success/15 text-success' : 'bg-hairline text-ink-muted',
                      )}
                    >
                      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {t.comment ?? t.subcategory ?? (isDeposit ? 'Зачисление' : 'Списание')}
                      </span>
                      <span className="text-xs text-ink-faint">{formatTime(t.occurredAt)}</span>
                    </span>
                    <Money value={t.amount} tone={isDeposit ? 'positive' : 'negative'} />
                  </GlassCard>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <CategorySheet
        category={openCategory}
        transactions={transactions}
        onClose={() => setOpenCategory(null)}
      />
      <OperationSheet />
      <EditTransactionSheet transaction={editing} onClose={() => setEditing(null)} />
      <QuickAddSheet open={quickAdd} onClose={() => setQuickAdd(false)} />
    </main>
  );
}

/** Компактный итог за месяц рядом с балансом: цвет + подпись, не только цвет. */
function SummaryChip({
  tone,
  label,
  value,
}: {
  tone: 'positive' | 'negative';
  label: string;
  value: number;
}) {
  const Icon = tone === 'positive' ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className="glass flex min-h-9 flex-1 items-center gap-2 rounded-2xl px-3 py-1.5 text-sm">
      <Icon
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className={tone === 'positive' ? 'text-success' : 'text-ink-muted'}
      />
      <span className="text-ink-faint">{label}</span>
      <Money value={value} compact className="ml-auto font-medium" />
    </span>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-6">
      {/* Подсказка — отдельной строкой: в одну строку с заголовком она обрезалась */}
      <div className="pb-2">
        <h2 className="text-sm font-semibold text-ink-muted">{title}</h2>
        {hint ? <p className="text-[11px] text-ink-faint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
