import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from './cn';

const TONE_STYLE = {
  info: 'border-hairline-strong text-ink',
  success: 'border-success/50 text-success',
  error: 'border-danger/60 text-danger',
} as const;

const TONE_ICON = { info: Info, success: CheckCircle2, error: AlertCircle } as const;

/** Уведомления поверх контента. role=status — скринридер прочитает без кражи фокуса. */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-60 flex flex-col items-center gap-2 pt-safe px-4"
    >
      {toasts.map((t) => {
        const Icon = TONE_ICON[t.tone];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cn(
              'glass pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm',
              'animate-[fade-in_var(--duration-fast)_ease-out]',
              TONE_STYLE[t.tone],
            )}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
