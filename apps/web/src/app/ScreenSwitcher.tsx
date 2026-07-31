import { useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import type { Tab } from '@/stores/useUiStore';
import { cn } from '@/shared/ui/cn';

/**
 * Плавный переход между вкладками-«окнами».
 *
 * При смене активной вкладки входящий экран подъезжает горизонтально с той
 * стороны, куда мы движемся по порядку вкладок (вперёд — справа, назад — слева),
 * а уходящий уезжает в противоположную и гаснет. Так переключение читается как
 * листание окон, а не мгновенная подмена.
 *
 * ПОЧЕМУ ДВА СЛОЯ. Уходящий экран нельзя просто размонтировать (тогда он
 * исчезает рывком) — он остаётся смонтированным абсолютным слоем поверх потока и
 * доигрывает выезд, после чего снимается по событию окончания анимации. Активный
 * слой лежит в потоке и задаёт высоту, поэтому подмена не прыгает.
 *
 * СОСТОЯНИЕ БЕЗ МЕРЦАНИЯ. Смена набора слоёв вычисляется прямо в рендере
 * (поддержанный React приём «скорректировать состояние при изменении пропса»):
 * это перерисовывает компонент до отрисовки, поэтому кадра со старым активным
 * экраном не возникает.
 *
 * ДОСТУПНОСТЬ. reduced-motion схлопывает обе анимации глобальным правилом в
 * styles/index.css — переход становится мгновенным. Порядок вкладок в остальном
 * прежний: экран каждой вкладки при повторном заходе монтируется заново и
 * подгружает данные, как и раньше.
 */

type LayerMode = 'active' | 'leaving';

interface Layer {
  readonly key: Tab;
  readonly mode: LayerMode;
  /** Направление перехода: +1 вперёд по порядку вкладок, −1 назад. */
  readonly dir: number;
}

interface SwitcherState {
  readonly active: Tab;
  readonly layers: readonly Layer[];
}

interface Props {
  readonly activeKey: Tab;
  /** Порядок вкладок — из него берётся знак направления перехода. */
  readonly order: readonly Tab[];
  readonly render: (key: Tab) => ReactNode;
}

function directionOf(order: readonly Tab[], from: Tab, to: Tab): number {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return 1;
  return b > a ? 1 : -1;
}

export function ScreenSwitcher({ activeKey, order, render }: Props) {
  const [state, setState] = useState<SwitcherState>(() => ({
    active: activeKey,
    layers: [{ key: activeKey, mode: 'active', dir: 1 }],
  }));

  // Активная вкладка сменилась: прежний активный слой становится уходящим,
  // прежние уходящие слои (при быстром переключении) отбрасываются мгновенно.
  if (state.active !== activeKey) {
    const dir = directionOf(order, state.active, activeKey);
    setState({
      active: activeKey,
      layers: [
        { key: state.active, mode: 'leaving', dir },
        { key: activeKey, mode: 'active', dir },
      ],
    });
  }

  const onLeaveEnd = (event: AnimationEvent<HTMLDivElement>, key: Tab): void => {
    // Ловим только собственный выезд слоя, а не всплывшие анимации содержимого.
    if (event.target !== event.currentTarget) return;
    setState((s) =>
      s.layers.some((l) => l.key === key && l.mode === 'leaving')
        ? { active: s.active, layers: s.layers.filter((l) => !(l.key === key && l.mode === 'leaving')) }
        : s,
    );
  };

  return (
    <div className="relative">
      {state.layers.map((layer) => (
        <div
          key={layer.key}
          className={cn(
            'screen-layer pb-24',
            layer.mode === 'active' ? 'screen-layer--enter' : 'screen-layer--leave',
          )}
          style={{ '--screen-dir': String(layer.dir) } as CSSProperties}
          aria-hidden={layer.mode === 'leaving' ? true : undefined}
          onAnimationEnd={
            layer.mode === 'leaving' ? (event) => onLeaveEnd(event, layer.key) : undefined
          }
        >
          {render(layer.key)}
        </div>
      ))}
    </div>
  );
}
