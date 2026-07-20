import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Plus,
  RefreshCw,
  WalletMinimal,
} from 'lucide-react';
import type { Transaction } from '@budget/shared';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { usePlannedStore } from '@/stores/usePlannedStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { Skeleton, SkeletonCard } from '@/shared/ui/Skeleton';
import { Button } from '@/shared/ui/Button';
import { formatDay, formatMoney, formatRelativeDay, formatTime } from '@/shared/lib/format';
import { haptics, isInsideTelegram } from '@/shared/lib/telegram';
import { useCurrency } from '@/shared/lib/useCurrency';
import { CategorySheet } from '@/features/category-details/CategorySheet';
import { CategoryCard } from '@/features/category-card/CategoryCard';
import { CalendarPanel } from '@/features/calendar/CalendarPanel';
import { DragNode, DropNode } from '@/features/dnd-matrix/dnd-nodes';
import { CategoryPager } from '@/features/category-pager/CategoryPager';
import { CreateEntitySheet, type EntityKind } from '@/features/entity-editor/CreateEntitySheet';
import { EditCategorySheet } from '@/features/entity-editor/EditCategorySheet';
import { OperationSheet } from '@/features/tx-editor/OperationSheet';
import { EditTransactionSheet } from '@/features/tx-editor/EditTransactionSheet';
import { QuickAddSheet } from '@/features/tx-editor/QuickAddSheet';
import type { CategoryWithStats } from '@/entities/category/api';
import { cn } from '@/shared/ui/cn';

/** Сколько операций дня показываем на главной, прежде чем увести в «Историю». */
const PREVIEW_LIMIT = 3;

/**
 * Главный экран: карусель времени, матрица Доход → Кошелёк → Расход,
 * последние операции выбранного дня и правка через шторку.
 */
export function HomeScreen() {
  const { wallets, categories, transactions, loading, error, load } = useBudgetStore();
  const selectedDay = useUiStore((s) => s.selectedDay);
  const setTab = useUiStore((s) => s.setTab);
  const monthStartDay = useSettingsStore((s) => s.monthStartDay);
  const periodStart = useSettingsStore((s) => s.periodStart);
  const periodEnd = useSettingsStore((s) => s.periodEnd);
  const currency = useCurrency();
  // С сервера берём только обязательства: они меняются редко (завели событие,
  // подтвердили списание) и оба раза стор перезагружается. Сам баланс держим
  // из кошельков — иначе после каждой операции в шапке висело бы старое число,
  // посчитанное на момент загрузки календаря.
  const upcoming = usePlannedStore((s) => s.summary?.upcoming ?? 0);

  const [openCategory, setOpenCategory] = useState<CategoryWithStats | null>(null);
  const [editingCategory, setEditingCategory] = useState<CategoryWithStats | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [creating, setCreating] = useState<EntityKind | null>(null);

  const totalBalance = useMemo(
    () => wallets.reduce((sum, w) => sum + w.balance, 0),
    [wallets],
  );
  const expenses = categories.filter((c) => c.kind === 'expense');
  const incomes = categories.filter((c) => c.kind === 'income');

  /*
   * Итог по расходам считаем по spent категорий, а не по ленте операций: лента
   * на главной обрезана последними записями, а spent приходит с сервера уже за
   * расчётный период — только он сходится с суммами на карточках.
   */
  const freeBalance = totalBalance - upcoming;

  const totalSpent = useMemo(
    () => expenses.reduce((sum, c) => sum + (c.spent ?? 0), 0),
    [expenses],
  );

  // ru-locale добавляет «г.» — для заголовка это лишний шум, собираем метку сами.
  // При сдвинутом дне начала месяца календарное название соврало бы, поэтому
  // показываем границы периода как есть: «2 июл — 1 авг».
  const monthLabel = useMemo(() => {
    if (monthStartDay !== 1 && periodStart && periodEnd) {
      return `${formatDay(periodStart)} — ${formatDay(periodEnd)}`;
    }
    const now = new Date();
    const month = new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(now);
    return `${month[0]?.toUpperCase()}${month.slice(1)} ${now.getFullYear()}`;
  }, [monthStartDay, periodStart, periodEnd]);

  /** Итоги расчётного периода — контекст к балансу: сколько пришло и сколько ушло. */
  const monthTotals = useMemo(() => {
    const from = periodStart ? new Date(periodStart) : new Date(new Date().setDate(1));
    if (!periodStart) from.setHours(0, 0, 0, 0);
    return transactions.reduce(
      (acc, t) => {
        if (new Date(t.occurredAt) < from) return acc;
        if (t.type === 'deposit') acc.income += t.amount;
        else acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );
  }, [transactions, periodStart]);

  // На главной — только свежие операции: полная лента живёт в разделе «История».
  const previewTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, PREVIEW_LIMIT),
    [transactions],
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
          {/* Главный вопрос — «сколько я могу потратить», а не «сколько лежит на счету».
              Пока обязательств нет, обе величины совпадают, и заголовок это признаёт. */}
          <p className="text-sm text-ink-muted">
            {upcoming > 0 ? 'Свободно до конца месяца' : 'Общий баланс'}
          </p>
          <p className="text-xs tracking-wide text-ink-faint">{monthLabel}</p>
        </div>
        {loading && wallets.length === 0 ? (
          <Skeleton className="mt-1 h-10 w-48" />
        ) : (
          <Money value={freeBalance} className="text-4xl font-semibold tracking-tight" />
        )}
        {upcoming > 0 && (
          <p className="pt-1 text-xs text-ink-faint">
            На счетах <Money value={totalBalance} className="text-ink-muted" />, из них{' '}
            <Money value={upcoming} className="text-ink-muted" /> уйдёт по календарю
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <SummaryChip tone="positive" label="Доход" value={monthTotals.income} />
          <SummaryChip tone="negative" label="Расход" value={monthTotals.expense} />
        </div>
      </header>

      <CalendarPanel />

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
          <AddButton label="Источник дохода" onClick={() => setCreating('income')} pill />
        </div>
      </Section>

      <Section
        title="Кошельки"
        hint="Цель зачисления и источник трат"
        total={totalBalance}
        totalLabel={`Всего на кошельках: ${formatMoney(totalBalance, currency)}`}
      >
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
            <AddButton label="Кошелёк" onClick={() => setCreating('wallet')} />
          </div>
        )}
      </Section>

      <Section
        title="Категории расходов"
        hint="Бросьте кошелёк на категорию, чтобы списать"
        total={totalSpent}
        totalLabel={`Потрачено за период: ${formatMoney(totalSpent, currency)}`}
      >
        {loading && expenses.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <CategoryPager
            items={expenses}
            keyOf={(c) => c.id}
            renderItem={(c) => <CategoryCard category={c} onOpen={setOpenCategory} />}
          />
        )}
        {/* Кнопка под пейджером, а не плиткой внутри: она не должна занимать
            место в постраничной сетке и уезжать на вторую страницу */}
        <div className="pt-3">
          <AddButton label="Категория расхода" onClick={() => setCreating('expense')} />
        </div>
      </Section>

      <Section title="Последние операции">
        {loading && transactions.length === 0 ? (
          <SkeletonCard />
        ) : previewTransactions.length === 0 ? (
          <GlassCard>
            <p className="text-sm text-ink-muted">
              Операций пока нет. Перетащите доход в кошелёк или нажмите «+».
            </p>
          </GlassCard>
        ) : (
          <ul className="flex flex-col gap-2">
            {previewTransactions.map((t) => {
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
                      <span className="text-xs text-ink-faint">
                        {formatRelativeDay(t.occurredAt)}, {formatTime(t.occurredAt)}
                      </span>
                    </span>
                    <Money value={t.amount} tone={isDeposit ? 'positive' : 'negative'} />
                  </GlassCard>
                </li>
              );
            })}
          </ul>
        )}

        {/* Единственный способ записать операцию без жеста: перетаскивание
            недоступно с клавиатуры и скринридера, поэтому точка входа обязана
            остаться — но обычной плиткой, а не плавающей кнопкой поверх ленты */}
        <div className="pt-2">
          <AddButton label="Записать операцию" onClick={() => setQuickAdd(true)} />
        </div>

        {/* Ссылка видна всегда: из неё понятно, что тремя строками дело не кончается */}
        <button
          type="button"
          onClick={() => {
            haptics.selection();
            setTab('history');
          }}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-1 text-sm text-brand"
        >
          Вся история
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Section>

      <CategorySheet
        category={openCategory}
        onClose={() => setOpenCategory(null)}
        // Одна шторка поверх другой не открывается: детали уступают место правке
        // и возвращаться в них после сохранения незачем — данные уже изменились.
        onEdit={(category) => {
          setOpenCategory(null);
          setEditingCategory(category);
        }}
      />
      <EditCategorySheet category={editingCategory} onClose={() => setEditingCategory(null)} />
      <OperationSheet />
      <EditTransactionSheet transaction={editing} onClose={() => setEditing(null)} />
      <QuickAddSheet open={quickAdd} onClose={() => setQuickAdd(false)} />
      <CreateEntitySheet kind={creating} onClose={() => setCreating(null)} />
    </main>
  );
}

/** Плитка «добавить» в конце списка сущностей: пунктир отличает её от данных. */
function AddButton({
  label,
  onClick,
  pill = false,
}: {
  label: string;
  onClick: () => void;
  pill?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptics.selection();
        onClick();
      }}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 border border-dashed border-hairline-strong',
        'px-4 text-sm text-ink-muted transition-colors duration-[var(--duration-fast)] active:bg-hairline',
        pill ? 'rounded-full' : 'w-full rounded-2xl py-3',
      )}
    >
      <Plus size={16} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
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
  total,
  totalLabel,
  children,
}: {
  title: string;
  hint?: string;
  /** Итог по разделу в минорных единицах. Не передан — строка с суммой не рисуется. */
  total?: number;
  /** Что означает сумма — только для скринридера: рядом с заголовком голое число неоднозначно. */
  totalLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-6">
      {/* Подсказка — отдельной строкой: в одну строку с заголовком она обрезалась */}
      <div className="pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-muted">{title}</h2>
          {total !== undefined ? (
            <span className="shrink-0" aria-label={totalLabel}>
              <Money value={total} className="text-sm font-semibold" />
            </span>
          ) : null}
        </div>
        {hint ? <p className="text-[11px] text-ink-faint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
