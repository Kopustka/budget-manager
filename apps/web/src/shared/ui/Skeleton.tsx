import { cn } from './cn';

/**
 * Скелетон вместо спиннера: место под контент резервируется заранее,
 * поэтому при загрузке нет скачка layout (CLS).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-2xl bg-hairline', className)}
    />
  );
}

export function SkeletonCard() {
  return <Skeleton className="h-24 w-full" />;
}
