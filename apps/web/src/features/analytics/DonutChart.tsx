import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatMoney, formatPercent } from '@/shared/lib/format';
import { haptics } from '@/shared/lib/telegram';
import { Money } from '@/shared/ui/Money';
import { cn } from '@/shared/ui/cn';

export interface DonutSlice {
  id: string;
  name: string;
  value: number;
  color: string;
  isOverdraft?: boolean;
}

interface DonutChartProps {
  slices: DonutSlice[];
  total: number;
}

const SIZE = 200;
const RADIUS = 78;
const THICKNESS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Просвет фона между сегментами — 2px, чтобы соседние заливки не слипались. */
const GAP = 2;

/**
 * Донат распределения трат.
 *
 * Часть-к-целому «на глаз»: не больше 6 сегментов (хвост уходит в «Другое»),
 * крупнейший начинается с 12 часов. Цвет не единственный носитель смысла —
 * рядом всегда легенда с названием, суммой и долей, а по тапу сегмент
 * подсвечивается и его значение уезжает в центр.
 */
export function DonutChart({ slices, total }: DonutChartProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Рисуем по убыванию: крупнейший сегмент стартует с 12 часов.
  const ordered = useMemo(() => [...slices].sort((a, b) => b.value - a.value), [slices]);

  const segments = useMemo(() => {
    let offset = 0;
    return ordered.map((slice) => {
      const share = total > 0 ? slice.value / total : 0;
      const length = Math.max(share * CIRCUMFERENCE - GAP, 0);
      const segment = { slice, share, length, offset };
      offset += share * CIRCUMFERENCE;
      return segment;
    });
  }, [ordered, total]);

  if (total <= 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-faint">
        За этот месяц трат ещё нет — распределение появится после первой операции.
      </p>
    );
  }

  const selected = ordered.find((s) => s.id === selectedId) ?? null;
  const selectedShare = selected && total > 0 ? selected.value / total : 0;

  return (
    <div>
      <div className="relative mx-auto w-[200px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-[200px] w-[200px] -rotate-90"
          role="img"
          aria-label={`Распределение трат: ${ordered
            .map((s) => `${s.name} ${formatMoney(s.value)}`)
            .join(', ')}`}
        >
          {segments.map(({ slice, length, offset }) => {
            const dimmed = selectedId !== null && slice.id !== selectedId;
            return (
              <circle
                key={slice.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={slice.color}
                strokeWidth={slice.id === selectedId ? THICKNESS + 6 : THICKNESS}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
                // Толщина меняется внутри SVG — соседний контент не сдвигается.
                className={cn(
                  'cursor-pointer transition-[stroke-width,opacity] duration-[var(--duration-fast)]',
                  dimmed && 'opacity-30',
                )}
                onClick={() => {
                  haptics.selection();
                  setSelectedId(slice.id === selectedId ? null : slice.id);
                }}
              />
            );
          })}
        </svg>

        {/* Центр: по умолчанию итог месяца, по тапу — выбранная категория */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center">
          <div>
            <p className="text-xs text-ink-faint">{selected ? selected.name : 'Всего'}</p>
            <Money
              value={selected ? selected.value : total}
              compact
              className="text-xl font-semibold"
            />
            {selected ? (
              <p className="tabular text-xs text-ink-muted">{formatPercent(selectedShare)}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Легенда обязательна: без неё смысл несёт только цвет */}
      <ul className="flex flex-col gap-1 pt-4">
        {ordered.map((slice) => {
          const share = total > 0 ? slice.value / total : 0;
          const active = slice.id === selectedId;
          return (
            <li key={slice.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  haptics.selection();
                  setSelectedId(active ? null : slice.id);
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-sm',
                  'transition-colors duration-[var(--duration-fast)]',
                  active ? 'bg-hairline' : 'bg-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: slice.color }}
                />
                <span className="min-w-0 flex-1 truncate">{slice.name}</span>
                {/* Значок вместо текстового бейджа: подпись съедала название категории */}
                {slice.isOverdraft ? (
                  <AlertTriangle
                    size={15}
                    strokeWidth={2}
                    className="shrink-0 text-danger"
                    aria-label="лимит превышен"
                  />
                ) : null}
                <span className="tabular shrink-0 text-ink-muted">{formatPercent(share)}</span>
                <Money value={slice.value} compact className="shrink-0 font-medium" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
