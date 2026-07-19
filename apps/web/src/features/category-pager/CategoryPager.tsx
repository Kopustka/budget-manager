import { useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/ui/cn';

interface CategoryPagerProps<T> {
  items: T[];
  /** Сколько карточек на странице (сетка 2×2). */
  perPage?: number;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}

/**
 * Постраничный просмотр категорий свайпом. Реализован на CSS scroll-snap:
 * нативная инерция и не мешает жестам dnd-kit, в отличие от перехвата touch-событий.
 */
export function CategoryPager<T>({
  items,
  perPage = 4,
  keyOf,
  renderItem,
}: CategoryPagerProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  const pages = useMemo(() => {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += perPage) result.push(items.slice(i, i + perPage));
    return result;
  }, [items, perPage]);

  if (pages.length === 0) return null;

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((chunk, index) => (
          <div
            key={index}
            className="grid w-full shrink-0 snap-start grid-cols-2 gap-3 pr-0.5"
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
        <div className="flex justify-center gap-1.5 pt-3" aria-hidden="true">
          {pages.map((_, index) => (
            <span
              key={index}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[var(--duration-base)]',
                index === page ? 'w-5 bg-brand' : 'w-1.5 bg-hairline-strong',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
