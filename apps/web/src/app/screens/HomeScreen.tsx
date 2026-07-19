import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, WalletMinimal } from 'lucide-react';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { LimitBar } from '@/shared/ui/LimitBar';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { Skeleton, SkeletonCard } from '@/shared/ui/Skeleton';
import { Button } from '@/shared/ui/Button';
import { formatRelativeDay, formatTime } from '@/shared/lib/format';
import { haptics, isInsideTelegram } from '@/shared/lib/telegram';
import { CategorySheet } from '@/features/category-details/CategorySheet';
import type { CategoryWithStats } from '@/entities/category/api';

/**
 * Главный экран Фазы 3: баланс, кошельки, категории с прогрессом лимита и лента.
 * Drag-and-Drop матрица подключается в Фазе 4 — здесь заложены её будущие цели.
 */
export function HomeScreen() {
  const { wallets, categories, transactions, loading, error, load } = useBudgetStore();
  const [openCategory, setOpenCategory] = useState<CategoryWithStats | null>(null);

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
      <header className="pt-2 pb-6">
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

      <Section title="Кошельки">
        {loading && wallets.length === 0 ? (
          <SkeletonCard />
        ) : (
          <div className="flex flex-col gap-3">
            {wallets.map((w) => (
              <GlassCard key={w.id} className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand">
                  <WalletMinimal size={22} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="text-xs text-ink-faint">{w.currency}</span>
                </span>
                <Money value={w.balance} className="text-lg font-semibold" />
              </GlassCard>
            ))}
          </div>
        )}
      </Section>

      <Section title="Источники дохода">
        <div className="flex flex-wrap gap-2">
          {incomes.map((c) => (
            <span
              key={c.id}
              className="glass flex min-h-11 items-center gap-2 rounded-full px-4 text-sm"
            >
              <CategoryIcon name={c.icon} color={c.color ?? 'var(--color-success)'} size={18} />
              {c.name}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Категории расходов">
        {loading && expenses.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {expenses.map((c) => (
              <GlassCard
                key={c.id}
                danger={c.isOverdraft}
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
            ))}
          </div>
        )}
      </Section>

      <Section title="История">
        {loading && transactions.length === 0 ? (
          <SkeletonCard />
        ) : transactions.length === 0 ? (
          <GlassCard>
            <p className="text-sm text-ink-muted">
              Пока нет операций. Перетащите доход в кошелёк, чтобы начать.
            </p>
          </GlassCard>
        ) : (
          <ul className="flex flex-col gap-2">
            {transactions.slice(0, 15).map((t) => {
              const isDeposit = t.type === 'deposit';
              const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight;
              return (
                <li key={t.id}>
                  <GlassCard className="flex items-center gap-3 py-3">
                    <span
                      className={
                        isDeposit
                          ? 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/15 text-success'
                          : 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-hairline text-ink-muted'
                      }
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
      </Section>

      <CategorySheet
        category={openCategory}
        transactions={transactions}
        onClose={() => setOpenCategory(null)}
      />
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pb-6">
      <h2 className="pb-2 text-sm font-semibold text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}
