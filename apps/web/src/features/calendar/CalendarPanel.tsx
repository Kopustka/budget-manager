import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Plus, SkipForward } from 'lucide-react';
import type { PlannedOccurrence } from '@budget/shared';
import { usePlannedStore } from '@/stores/usePlannedStore';
import { useUiStore } from '@/stores/useUiStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Money } from '@/shared/ui/Money';
import { Button } from '@/shared/ui/Button';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { formatDay, formatRelativeDay } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { ApiError } from '@/shared/api/client';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { PlannedSheet } from './PlannedSheet';
import { cn } from '@/shared/ui/cn';

const DAYS = 30;
const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Финансовый календарь: 30 дней вперёд с маркерами обязательных списаний.
 *
 * Панель свёрнута по умолчанию: на главном экране она нужна не постоянно, а в
 * момент планирования — развёрнутая, она отодвигала бы матрицу, ради которой
 * экран и открывают. В свёрнутом виде остаётся строка со свободным остатком,
 * то есть главный ответ («сколько я могу потратить») виден всегда.
 */
export function CalendarPanel() {
  const { occurrences, summary, load, confirm, skip, busy } = usePlannedStore();
  const categories = useBudgetStore((s) => s.categories);
  const notify = useUiStore((s) => s.notify);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  /** Какое правило открыть на правке; null — форма создания. */
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  /** Ближайшие 30 дней вперёд — календарь смотрит в будущее, а не в прошлое. */
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });
  }, []);

  /** События по дням: маркер на числе и карточка под каруселью. */
  const byDay = useMemo(() => {
    const map = new Map<string, PlannedOccurrence[]>();
    for (const o of occurrences) {
      const list = map.get(o.dueDate);
      if (list) list.push(o);
      else map.set(o.dueDate, [o]);
    }
    return map;
  }, [occurrences]);

  const todayKey = dayKey(new Date());
  const selectedItems = selected ? (byDay.get(selected) ?? []) : [];

  async function settle(o: PlannedOccurrence, action: 'confirm' | 'skip') {
    try {
      haptics.impact('medium');
      if (action === 'confirm') await confirm(o.plannedId, o.dueDate);
      else await skip(o.plannedId, o.dueDate);
      haptics.success();
      notify(action === 'confirm' ? 'Списание записано' : 'Списание пропущено', 'success');
    } catch (err) {
      haptics.error();
      notify(err instanceof ApiError ? err.message : 'Не удалось отметить', 'error');
    }
  }

  return (
    <section className="pb-6">
      <GlassCard className="p-0">
        {/* Свёрнутая строка — главный ответ: сколько реально свободно */}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            haptics.selection();
            setOpen((v) => !v);
          }}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/15 text-brand">
            <CalendarDays size={22} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Финансовый календарь</span>
            <span className="text-xs text-ink-faint">
              {summary && summary.upcoming > 0
                ? `Впереди списаний на ${Math.round(summary.upcoming / 100).toLocaleString('ru-RU')} · ближайшее ${summary.nextDueDate ? formatDay(`${summary.nextDueDate}T12:00:00.000Z`) : ''}`
                : 'Обязательных списаний впереди нет'}
            </span>
          </span>
          <ChevronDown
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-ink-muted transition-transform duration-[var(--duration-base)]',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div className="border-t border-hairline px-4 pt-3 pb-4">
            {/* Полоса дней: маркер — тонкое кольцо, чтобы не спорить с числом */}
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {days.map((date) => {
                const key = dayKey(date);
                const items = byDay.get(key) ?? [];
                const pending = items.filter((o) => o.status === 'pending');
                const isToday = key === todayKey;
                const active = key === selected;

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${formatDay(date.toISOString())}${pending.length ? `, списаний: ${pending.length}` : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      haptics.selection();
                      setSelected(active ? null : key);
                    }}
                    className={cn(
                      'flex w-12 shrink-0 flex-col items-center gap-0.5 rounded-2xl py-2',
                      'transition-colors duration-[var(--duration-fast)]',
                      active ? 'bg-brand text-brand-ink' : 'bg-hairline',
                      // Ожидающее списание — синее кольцо; оплаченное уже не тревожит
                      !active && pending.length > 0 && 'ring-1 ring-brand',
                      isToday && !active && 'ring-1 ring-ink-muted',
                    )}
                  >
                    <span className="text-[10px] opacity-70">{WEEKDAY.format(date)}</span>
                    <span className="tabular text-sm font-semibold">{date.getDate()}</span>
                    <span
                      className={cn(
                        'h-1 w-1 rounded-full',
                        pending.length > 0
                          ? active
                            ? 'bg-brand-ink'
                            : 'bg-brand'
                          : items.length > 0
                            ? 'bg-ink-faint'
                            : 'bg-transparent',
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {/* Карточка выехавшего дня: подтвердить или пропустить */}
            {selected && (
              <div className="pt-3">
                <p className="pb-2 text-xs font-semibold text-ink-muted">
                  {formatRelativeDay(`${selected}T12:00:00.000Z`)}
                </p>
                {selectedItems.length === 0 ? (
                  <p className="text-sm text-ink-faint">В этот день списаний не запланировано.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {selectedItems.map((o) => {
                      const category = categories.find((c) => c.id === o.categoryId);
                      const settled = o.status !== 'pending';
                      return (
                        <li
                          key={`${o.plannedId}:${o.dueDate}`}
                          className={cn(
                            'rounded-2xl border p-3 transition-colors duration-[var(--duration-base)]',
                            // Ожидающее — прозрачное, состоявшееся — насыщенное
                            settled
                              ? 'border-transparent bg-brand/15'
                              : 'border-dashed border-hairline-strong bg-transparent',
                          )}
                        >
                          {/* Тап по событию открывает шторку правки: сумма
                              подписки меняется чаще, чем заводится новая */}
                          <button
                            type="button"
                            aria-label={`Изменить событие ${o.name}`}
                            onClick={() => {
                              haptics.selection();
                              setEditId(o.plannedId);
                              setEditorOpen(true);
                            }}
                            className="flex w-full items-center gap-2 text-left"
                          >
                            <CategoryIcon name={category?.icon ?? null} color={category?.color} size={16} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {o.name}
                            </span>
                            <Money value={o.amount} className="text-sm font-semibold" />
                          </button>
                          <p className="pt-1 text-[11px] text-ink-faint">
                            {o.status === 'paid'
                              ? 'Оплачено'
                              : o.status === 'skipped'
                                ? 'Пропущено'
                                : 'Ожидает подтверждения'}
                            {o.recurrence === 'monthly' ? ' · ежемесячно' : ''}
                          </p>

                          {!settled && (
                            <div className="flex gap-2 pt-2">
                              {/* px-3 вместо базового px-5: две кнопки с иконками
                                  в узкой карточке иначе не помещаются в строку */}
                              <Button
                                className="min-w-0 flex-1 px-3 text-sm"
                                disabled={busy}
                                onClick={() => void settle(o, 'confirm')}
                              >
                                <Check size={16} strokeWidth={2} aria-hidden="true" />
                                Подтвердить
                              </Button>
                              <Button
                                variant="secondary"
                                className="min-w-0 flex-1 px-3 text-sm"
                                disabled={busy}
                                onClick={() => void settle(o, 'skip')}
                              >
                                <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
                                Пропустить
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                haptics.selection();
                setEditId(null);
                setEditorOpen(true);
              }}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline-strong text-sm text-ink-muted transition-colors duration-[var(--duration-fast)] active:bg-hairline"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Обязательная трата
            </button>
          </div>
        )}
      </GlassCard>

      <PlannedSheet
        open={editorOpen}
        editId={editId}
        onClose={() => {
          setEditorOpen(false);
          setEditId(null);
        }}
      />
    </section>
  );
}
