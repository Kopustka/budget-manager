import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePlannedStore } from '@/stores/usePlannedStore';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { AmountField, parseAmount } from '@/features/tx-editor/AmountField';
import { cn } from '@/shared/ui/cn';

/** Ежемесячное или разовое — два разных способа задать дату. */
type Mode = 'monthly' | 'once';

/**
 * Заведение обязательной траты и список уже заведённых.
 *
 * Дата у ежемесячного события задаётся числом месяца, а не календарём: аренда
 * платится «пятого», а не «пятого августа», и выбор конкретной даты пришлось бы
 * повторять каждый месяц.
 */
export function PlannedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { rules, create, remove } = usePlannedStore();
  const categories = useBudgetStore((s) => s.categories);
  const notify = useUiStore((s) => s.notify);

  const expenses = categories.filter((c) => c.kind === 'expense');

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<Mode>('monthly');
  const [dueDay, setDueDay] = useState(1);
  const [dueDate, setDueDate] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setAmount('');
    setMode('monthly');
    setDueDay(new Date().getDate() > 28 ? 1 : new Date().getDate());
    setDueDate(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    setCategoryId(expenses[0]?.id ?? null);
    setError(null);
    // expenses пересобирается каждый рендер — завязываться на него нельзя,
    // иначе форма сбрасывалась бы при любом обновлении справочников.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function submit() {
    const trimmed = name.trim();
    const minor = parseAmount(amount);
    if (!trimmed) return fail('Введите название');
    if (minor === null) return fail('Введите сумму больше нуля');
    if (!categoryId) return fail('Нужна категория расхода — создайте её на главном экране');

    setSaving(true);
    setError(null);
    try {
      await create({
        name: trimmed,
        amount: minor,
        categoryId,
        recurrence: mode,
        ...(mode === 'monthly' ? { dueDay } : { dueDate }),
      });
      haptics.success();
      notify('Событие добавлено в календарь', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  function fail(message: string) {
    setError(message);
    haptics.error();
  }

  return (
    <BottomSheet
      open
      title="Обязательная трата"
      onClose={onClose}
      footer={
        <Button full disabled={saving} onClick={() => void submit()}>
          {saving ? 'Сохраняем…' : 'Добавить в календарь'}
        </Button>
      }
    >
      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">Название</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="например, Аренда"
          maxLength={40}
          className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
        />
      </label>

      <div className="pt-4">
        <AmountField value={amount} onChange={setAmount} quickAmounts={[]} />
      </div>

      <div className="pt-4">
        <p className="pb-2 text-sm text-ink-muted">Когда списывается</p>
        <div className="flex gap-2 pb-3">
          {(
            [
              ['monthly', 'Каждый месяц'],
              ['once', 'Один раз'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                haptics.selection();
                setMode(value);
              }}
              className={cn(
                'min-h-11 flex-1 rounded-2xl text-sm transition-colors duration-[var(--duration-fast)]',
                mode === value ? 'bg-brand font-semibold text-brand-ink' : 'bg-hairline',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'monthly' ? (
          <>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={day === dueDay}
                  onClick={() => {
                    haptics.selection();
                    setDueDay(day);
                  }}
                  className={cn(
                    'tabular grid h-10 place-items-center rounded-xl text-sm transition-colors duration-[var(--duration-fast)]',
                    day === dueDay ? 'bg-brand font-semibold text-brand-ink' : 'bg-hairline',
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
            <p className="pt-2 text-xs text-ink-faint">
              Больше 28 выбрать нельзя: такого числа нет в феврале, и событие пропадало бы
              раз в год.
            </p>
          </>
        ) : (
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="tabular w-full rounded-2xl bg-hairline px-4 py-3 outline-none"
          />
        )}
      </div>

      <div className="pt-4">
        <p className="pb-2 text-sm text-ink-muted">Категория</p>
        <div className="flex flex-wrap gap-2">
          {expenses.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={categoryId === c.id}
              onClick={() => {
                haptics.selection();
                setCategoryId(c.id);
              }}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-full px-3 text-sm',
                'transition-colors duration-[var(--duration-fast)]',
                categoryId === c.id ? 'bg-brand text-brand-ink' : 'bg-hairline',
              )}
            >
              <CategoryIcon
                name={c.icon}
                color={categoryId === c.id ? 'currentColor' : c.color}
                size={16}
              />
              {c.name}
            </button>
          ))}
        </div>
        <p className="pt-2 text-xs text-ink-faint">
          Подтверждённое списание запишется в эту категорию — как обычная трата.
        </p>
      </div>

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}

      {rules.length > 0 && (
        <div className="mt-5 border-t border-hairline pt-4">
          <p className="pb-2 text-sm text-ink-muted">Уже в календаре</p>
          <ul className="flex flex-col gap-1">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  <span className="text-xs text-ink-faint">
                    {r.recurrence === 'monthly' ? ` · ${r.dueDay} числа` : ` · ${r.dueDate}`}
                  </span>
                </span>
                <Money value={r.amount} className="text-sm" />
                <button
                  type="button"
                  aria-label={`Удалить ${r.name}`}
                  onClick={() => {
                    haptics.impact('medium');
                    void remove(r.id);
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-muted transition-colors duration-[var(--duration-fast)] active:bg-hairline"
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BottomSheet>
  );
}
