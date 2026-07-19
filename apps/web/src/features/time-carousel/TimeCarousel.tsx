import { useEffect, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { Transaction } from '@budget/shared';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import { formatMoneyCompact } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { cn } from '@/shared/ui/cn';

const DAYS = 30;
const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

interface TimeCarouselProps {
  transactions: Transaction[];
  /** Кнопка «+»: добавить операцию за выбранный день, в том числе задним числом. */
  onQuickAdd: () => void;
}

/**
 * Карусель времени: 30 дней назад. Выбранный день определяет, что показывает
 * лента и какой датой запишется новая операция.
 */
export function TimeCarousel({ transactions, onQuickAdd }: TimeCarouselProps) {
  const selectedDay = useUiStore((s) => s.selectedDay);
  const setSelectedDay = useUiStore((s) => s.setSelectedDay);
  const currency = useCurrency();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLButtonElement>(null);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (DAYS - 1 - i));
      return date;
    });
  }, []);

  /** Расход по дням — подпись под числом, чтобы «горячие» дни были видны сразу. */
  const spentByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== 'spend') continue;
      const key = localDayKey(new Date(t.occurredAt));
      map.set(key, (map.get(key) ?? 0) + t.amount);
    }
    return map;
  }, [transactions]);

  // При открытии показываем сегодня — правый край ленты.
  useEffect(() => {
    todayRef.current?.scrollIntoView({ inline: 'end', block: 'nearest' });
  }, []);

  const todayKey = localDayKey(new Date());

  return (
    <div className="flex items-end gap-2 pb-4">
      <div
        ref={scrollerRef}
        className="flex flex-1 gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((date) => {
          const key = localDayKey(date);
          const active = key === selectedDay;
          const isToday = key === todayKey;
          const spent = spentByDay.get(key) ?? 0;

          return (
            <button
              key={key}
              ref={isToday ? todayRef : undefined}
              type="button"
              aria-pressed={active}
              aria-label={`${date.getDate()} ${WEEKDAY.format(date)}${spent ? `, расход ${formatMoneyCompact(spent, currency)}` : ''}`}
              onClick={() => {
                haptics.selection();
                setSelectedDay(key);
              }}
              className={cn(
                'flex min-h-16 w-14 shrink-0 flex-col items-center justify-center rounded-2xl px-1',
                'transition-colors duration-[var(--duration-fast)]',
                active ? 'bg-brand text-brand-ink' : 'glass text-ink',
              )}
            >
              <span className={cn('text-[11px]', active ? 'opacity-80' : 'text-ink-faint')}>
                {WEEKDAY.format(date)}
              </span>
              <span className="tabular text-lg font-semibold leading-tight">{date.getDate()}</span>
              {/* Точка вместо суммы, когда места мало: сумма читается по aria-label */}
              <span
                className={cn(
                  'tabular text-[10px] leading-tight',
                  active ? 'opacity-80' : spent ? 'text-ink-muted' : 'text-transparent',
                )}
              >
                {spent ? formatMoneyCompact(spent, currency) : '·'}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          haptics.impact('medium');
          onQuickAdd();
        }}
        aria-label="Добавить операцию за выбранный день"
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink transition-transform duration-[var(--duration-fast)] active:scale-95"
      >
        <Plus size={24} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Ключ дня в локальном времени пользователя — карусель живёт в его часовом поясе. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
