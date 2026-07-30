import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarRange, Coins, Download, Users } from 'lucide-react';
import { CURRENCIES, MAX_MONTH_START_DAY, currencyInfo } from '@budget/shared';
import { settingsApi } from '@/entities/settings/api';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Button } from '@/shared/ui/Button';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { ProfilesSection } from '@/features/profiles/ProfilesSection';
import { cn } from '@/shared/ui/cn';

/** Настройки: валюта, начало расчётного месяца и выгрузка операций. */
export function SettingsScreen() {
  const { currency, monthStartDay, periodStart, periodEnd, apply, load } = useSettingsStore();
  const reloadBudget = useBudgetStore((s) => s.load);
  const notify = useUiStore((s) => s.notify);

  const [savingDay, setSavingDay] = useState(false);
  const [currencySheet, setCurrencySheet] = useState(false);

  useEffect(() => {
    if (!periodStart) void load();
  }, [periodStart, load]);

  async function changeDay(day: number) {
    setSavingDay(true);
    try {
      const settings = await settingsApi.setMonthStartDay(day);
      apply(settings);
      await reloadBudget();
      haptics.success();
      notify('Начало месяца обновлено', 'success');
    } catch (err) {
      haptics.error();
      notify(err instanceof ApiError ? err.message : 'Не удалось сохранить', 'error');
    } finally {
      setSavingDay(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-safe">
      <h1 className="pt-2 pb-4 text-sm text-ink-muted">Настройки</h1>

      <Section
        icon={<Users size={18} strokeWidth={1.75} />}
        title="Профили"
        hint="Отдельные бюджеты со своими кошельками, категориями и валютой"
      >
        <ProfilesSection />
      </Section>

      <Section icon={<Coins size={18} strokeWidth={1.75} />} title="Валюта">
        <GlassCard className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-hairline text-xl">
            {currencyInfo(currency).symbol}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{currencyInfo(currency).name}</span>
            <span className="text-xs text-ink-faint">{currency}</span>
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              haptics.selection();
              setCurrencySheet(true);
            }}
          >
            Сменить
          </Button>
        </GlassCard>
      </Section>

      <Section
        icon={<CalendarRange size={18} strokeWidth={1.75} />}
        title="Начало месяца"
        hint={
          periodStart && periodEnd
            ? `Текущий период: ${formatPeriod(periodStart, periodEnd)}`
            : undefined
        }
      >
        <GlassCard>
          <p className="pb-3 text-sm text-ink-muted">
            С какого числа начинается ваш расчётный месяц. Например, если зарплата приходит
            2-го, выберите 2 — планы и аналитика будут считаться со 2-го по 1-е.
          </p>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1).map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={day === monthStartDay}
                disabled={savingDay}
                onClick={() => {
                  haptics.selection();
                  void changeDay(day);
                }}
                className={cn(
                  'tabular grid h-10 place-items-center rounded-xl text-sm',
                  'transition-colors duration-[var(--duration-fast)]',
                  day === monthStartDay ? 'bg-brand font-semibold text-brand-ink' : 'bg-hairline',
                  savingDay && 'opacity-60',
                )}
              >
                {day}
              </button>
            ))}
          </div>
          <p className="pt-3 text-xs text-ink-faint">
            Больше 28 выбрать нельзя: такого числа нет в феврале.
          </p>
        </GlassCard>
      </Section>

      <Section icon={<Download size={18} strokeWidth={1.75} />} title="Выгрузка операций">
        <ExportCard />
      </Section>

      <CurrencySheet
        open={currencySheet}
        current={currency}
        onClose={() => setCurrencySheet(false)}
      />
    </main>
  );
}

/** Выгрузка: файл приходит в чат с ботом — в Telegram это работает надёжнее скачивания. */
function ExportCard() {
  const { periodStart, periodEnd } = useSettingsStore();
  const notify = useUiStore((s) => s.notify);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(label: string, range?: { from?: string; to?: string }) {
    setBusy(label);
    try {
      const result = await settingsApi.exportHistory(range);
      haptics.success();
      notify(`Файл отправлен в чат: ${result.rows} операций`, 'success');
    } catch (err) {
      haptics.error();
      notify(err instanceof ApiError ? err.message : 'Не удалось выгрузить', 'error');
    } finally {
      setBusy(null);
    }
  }

  const year = new Date();
  year.setUTCFullYear(year.getUTCFullYear() - 1);

  return (
    <GlassCard>
      <p className="pb-3 text-sm text-ink-muted">
        Пришлём CSV в чат с ботом — файл откроется в Excel или Google Таблицах.
      </p>
      <div className="flex flex-col gap-2">
        <Button
          full
          variant="secondary"
          disabled={busy !== null}
          onClick={() =>
            void send('period', {
              from: periodStart ?? undefined,
              to: periodEnd ?? undefined,
            })
          }
        >
          {busy === 'period' ? 'Отправляем…' : 'Текущий период'}
        </Button>
        <Button
          full
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void send('year', { from: year.toISOString() })}
        >
          {busy === 'year' ? 'Отправляем…' : 'За последний год'}
        </Button>
        <Button full disabled={busy !== null} onClick={() => void send('all')}>
          {busy === 'all' ? 'Отправляем…' : 'Все операции'}
        </Button>
      </div>
    </GlassCard>
  );
}

/**
 * Смена валюты. Пересчёт необратим, поэтому шторка требует явного курса и
 * показывает пример пересчёта до подтверждения.
 */
function CurrencySheet({
  open,
  current,
  onClose,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
}) {
  const { apply } = useSettingsStore();
  const reloadBudget = useBudgetStore((s) => s.load);
  const load = useSettingsStore((s) => s.load);
  const notify = useUiStore((s) => s.notify);

  const [target, setTarget] = useState<string>(current);
  const [rate, setRate] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTarget(current);
      setRate('1');
      setError(null);
    }
  }, [open, current]);

  if (!open) return null;

  const parsedRate = Number(rate.replace(',', '.'));
  const valid = Number.isFinite(parsedRate) && parsedRate > 0 && target !== '';
  const example = valid ? Math.round(100_000 * parsedRate) / 100 : null;

  async function submit() {
    if (!valid) {
      setError('Введите курс больше нуля');
      haptics.error();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await settingsApi.changeCurrency({ currency: target, rate: parsedRate });
      // load() уже приносит настройки профиля с сервера, включая новую валюту —
      // собирать ответ повторно из кусков стора значит рисковать разъездом.
      await load();
      await reloadBudget();
      haptics.success();
      notify(`Пересчитано операций: ${result.transactions}`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить валюту');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      title="Смена валюты"
      onClose={onClose}
      footer={
        <Button full variant="danger" disabled={busy || !valid} onClick={() => void submit()}>
          {busy ? 'Пересчитываем…' : 'Пересчитать и сохранить'}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2 pb-4">
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            type="button"
            aria-pressed={target === c.code}
            onClick={() => {
              haptics.selection();
              setTarget(c.code);
            }}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full px-4 text-sm',
              'transition-colors duration-[var(--duration-fast)]',
              target === c.code ? 'bg-brand text-brand-ink' : 'bg-hairline',
            )}
          >
            <span>{c.symbol}</span>
            {c.code}
          </button>
        ))}
      </div>

      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">
          Курс: сколько {currencyInfo(target).code} в одном {currencyInfo(current).code}
        </span>
        <input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))}
          className="tabular w-full rounded-2xl bg-hairline px-4 py-3 text-xl font-semibold outline-none"
        />
      </label>

      {example !== null && (
        <p className="pt-2 text-sm text-ink-muted">
          Пример: 1 000 {currencyInfo(current).symbol} станут{' '}
          <span className="tabular text-ink">
            {example.toLocaleString('ru-RU')} {currencyInfo(target).symbol}
          </span>
        </p>
      )}

      {/* Предупреждение до кнопки: после подтверждения откатить будет нечем */}
      <div className="mt-4 flex gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-3">
        <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <p className="text-sm text-danger">
          Все балансы, операции и планы будут умножены на курс. Отменить пересчёт из
          приложения нельзя.
        </p>
      </div>

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-6">
      <div className="flex items-center gap-2 pb-2 text-ink-muted">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {hint ? <p className="pb-2 text-xs text-ink-faint">{hint}</p> : null}
      {children}
    </section>
  );
}

const DAY_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatPeriod(start: string, end: string): string {
  const last = new Date(new Date(end).getTime() - 86_400_000);
  return `${DAY_FMT.format(new Date(start))} — ${DAY_FMT.format(last)}`;
}
