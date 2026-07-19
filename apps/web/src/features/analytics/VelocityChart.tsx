import { useMemo, useRef, useState } from 'react';
import type { VelocityPoint } from '@budget/shared';
import { formatMoneyCompact } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { Money } from '@/shared/ui/Money';
import { haptics } from '@/shared/lib/telegram';

interface VelocityChartProps {
  points: VelocityPoint[];
  /** Сумма лимитов за период; null — равномерную кривую строить не от чего. */
  budget: number | null;
  /** Индекс «сегодня» в периоде; null для завершённых месяцев. */
  todayIndex: number | null;
}

const W = 320;
const H = 180;
const PAD = { top: 16, right: 16, bottom: 24, left: 16 };

/**
 * Скорость трат: факт нарастающим итогом против равномерной кривой бюджета.
 *
 * Это форма «одна серия — суть, вторая — контекст»: факт берёт акцентный цвет,
 * идеал остаётся пунктирной серой опорой. Обе величины в одних деньгах, поэтому
 * ось одна — второй шкалы здесь быть не может.
 */
export function VelocityChart({ points, budget, todayIndex }: VelocityChartProps) {
  const currency = useCurrency();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const factCount = todayIndex === null ? points.length : Math.min(todayIndex + 1, points.length);

  const max = useMemo(() => {
    const values = [
      ...points.slice(0, factCount).map((p) => p.cumulative),
      ...(budget === null ? [] : points.map((p) => p.ideal)),
    ];
    return Math.max(...values, 1);
  }, [points, factCount, budget]);

  if (points.length === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (plotW * index) / Math.max(points.length - 1, 1);
  const y = (value: number) => PAD.top + plotH - (plotH * value) / max;

  const factPath = points
    .slice(0, factCount)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.cumulative).toFixed(1)}`)
    .join(' ');
  const idealPath =
    budget === null
      ? null
      : points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.ideal).toFixed(1)}`)
          .join(' ');

  const last = points[factCount - 1];
  const hovered = hover === null ? null : points[hover];

  function handlePointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relative = ((event.clientX - rect.left) / rect.width) * W;
    const index = Math.round(
      ((relative - PAD.left) / plotW) * Math.max(points.length - 1, 1),
    );
    const clamped = Math.min(Math.max(index, 0), points.length - 1);
    if (clamped !== hover) {
      haptics.selection();
      setHover(clamped);
    }
  }

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Скорость трат: к текущему дню потрачено ${formatMoneyCompact(
          last?.cumulative ?? 0,
          currency,
        )}${budget === null ? '' : `, равномерный план ${formatMoneyCompact(last?.ideal ?? 0, currency)}`}`}
        onPointerDown={handlePointer}
        onPointerMove={(e) => e.buttons > 0 && handlePointer(e)}
        onPointerLeave={() => setHover(null)}
      >
        {/* Сетка нарочито тихая: она ориентир, а не содержание */}
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(max * ratio)}
            y2={y(max * ratio)}
            stroke="var(--color-hairline)"
            strokeWidth={1}
          />
        ))}

        {idealPath ? (
          <path
            d={idealPath}
            fill="none"
            stroke="var(--color-ink-faint)"
            strokeWidth={2}
            strokeDasharray="5 5"
            strokeLinecap="round"
          />
        ) : null}

        {/* Мягкое свечение под фактом — акцент читается на тёмном фоне */}
        <path
          d={factPath}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.18}
        />
        <path
          d={factPath}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {last ? (
          <circle
            cx={x(factCount - 1)}
            cy={y(last.cumulative)}
            r={4}
            fill="var(--color-brand)"
            stroke="var(--color-canvas)"
            strokeWidth={2}
          />
        ) : null}

        {hovered ? (
          <g pointerEvents="none">
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-hairline-strong)"
              strokeWidth={1}
            />
            <circle
              cx={x(hover!)}
              cy={y(hovered.cumulative)}
              r={4}
              fill="var(--color-brand)"
              stroke="var(--color-canvas)"
              strokeWidth={2}
            />
            {/* Маркер и на плановой кривой: смысл графика — сравнить две величины в одной точке */}
            {budget === null ? null : (
              <circle
                cx={x(hover!)}
                cy={y(hovered.ideal)}
                r={3.5}
                fill="var(--color-ink-faint)"
                stroke="var(--color-canvas)"
                strokeWidth={2}
              />
            )}
          </g>
        ) : null}

        {/* Подписи оси X: только края и середина — иначе цифры сливаются */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((index) => (
          <text
            key={index}
            x={x(index)}
            y={H - 6}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            className="fill-[var(--color-ink-faint)] text-[10px]"
          >
            {Number(points[index]?.day.slice(-2))}
          </text>
        ))}
      </svg>

      {/* Легенда: две серии — значит подписи обязательны, цвета мало */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-brand" />
          <span className="text-ink-muted">Факт</span>
          <Money value={(hovered ?? last)?.cumulative ?? 0} compact className="text-ink" />
        </span>
        {budget === null ? (
          <span className="text-ink-faint">Лимиты не заданы — плановая кривая недоступна</span>
        ) : (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0 w-5 border-t-2 border-dashed border-[var(--color-ink-faint)]"
            />
            <span className="text-ink-muted">Равномерно</span>
            <Money value={(hovered ?? last)?.ideal ?? 0} compact className="text-ink" />
          </span>
        )}
        {hovered ? (
          <span className="text-ink-faint">
            {Number(hovered.day.slice(-2))} число
          </span>
        ) : null}
      </div>
    </div>
  );
}
