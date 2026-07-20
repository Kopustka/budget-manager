import { useCallback, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/shared/ui/cn';

interface CategoryPagerProps<T> {
  items: T[];
  /** Сколько карточек на странице (сетка 2×4). */
  perPage?: number;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}

/** С какого смещения мыши считаем, что это листание, а не промах по карточке. */
const DRAG_THRESHOLD = 8;

/**
 * Постраничный просмотр категорий. На тач-устройствах листание нативное
 * (CSS scroll-snap): своя инерция была бы хуже системной и мешала бы жестам
 * dnd-kit. Мышь так не умеет — для неё добавлено протаскивание и кликабельные
 * точки, иначе на десктопе вторая страница недостижима вовсе.
 */
export function CategoryPager<T>({
  items,
  perPage = 8,
  keyOf,
  renderItem,
}: CategoryPagerProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);

  const drag = useRef<{ startX: number; scrollLeft: number; moved: boolean } | null>(null);
  /** Протаскивание заканчивается кликом по карточке — его нужно проглотить. */
  const justDragged = useRef(false);

  const pages = useMemo(() => {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += perPage) result.push(items.slice(i, i + perPage));
    return result;
  }, [items, perPage]);

  const goTo = useCallback((index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  }, []);

  if (pages.length === 0) return null;

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // Тач и перо листают сами — перехватывать их значит ломать инерцию.
    if (e.pointerType !== 'mouse') return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const el = scrollerRef.current;
    const state = drag.current;
    if (!el || !state) return;

    const dx = e.clientX - state.startX;
    if (!state.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      state.moved = true;
      // Snap мешает вести ленту за курсором — включим обратно на отпускании.
      setDragging(true);
    }
    el.scrollLeft = state.scrollLeft - dx;
  }

  function onPointerUp() {
    const el = scrollerRef.current;
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;

    justDragged.current = true;
    setDragging(false);
    // Доводим до ближайшей страницы сами: snap не срабатывает на программный скролл.
    if (el) goTo(Math.round(el.scrollLeft / el.clientWidth));
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClickCapture={(e) => {
          if (!justDragged.current) return;
          justDragged.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        className={cn(
          'flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          dragging ? 'cursor-grabbing select-none' : 'snap-x snap-mandatory',
        )}
      >
        {pages.map((chunk, index) => (
          <div
            key={index}
            className="grid w-full shrink-0 snap-start grid-cols-2 gap-2 pr-0.5"
            role="group"
            aria-label={`Страница ${index + 1} из ${pages.length}`}
          >
            {chunk.map((item) => (
              <div key={keyOf(item)}>{renderItem(item)}</div>
            ))}
          </div>
        ))}
      </div>

      {pages.length > 1 && (
        // Точки — не украшение, а единственная клавиатурная навигация по страницам.
        <div className="flex justify-center gap-1.5 pt-3">
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Страница ${index + 1}`}
              aria-current={index === page}
              className="grid h-11 w-6 place-items-center"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all duration-[var(--duration-base)]',
                  index === page ? 'w-5 bg-brand' : 'w-1.5 bg-hairline-strong',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
