import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { haptics } from '@/shared/lib/telegram';

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Закрепить снизу (кнопки подтверждения) — не уезжает при скролле контента. */
  footer?: ReactNode;
}

/**
 * Модальная шторка снизу — основной способ ввода в приложении.
 * Закрывается по Esc, тапу по затемнению и кнопке; фокус уходит внутрь шторки,
 * фон скрыт от скринридера (aria-modal), скролл body заблокирован.
 */
export function BottomSheet({ open, title, onClose, children, footer }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const close = () => {
    haptics.selection();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Скрим 55% — фон не должен конкурировать с содержимым шторки */}
      <div
        className="absolute inset-0 bg-[var(--color-scrim)] animate-[fade-in_var(--duration-fast)_ease-out]"
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-md outline-none',
          'rounded-t-[var(--radius-sheet)] border-t border-hairline-strong bg-elevated',
          'animate-[sheet-in_var(--duration-base)_var(--ease-ios)]',
          'max-h-[88vh] flex flex-col',
        )}
      >
        {/* Ручка-индикатор: подсказывает, что шторку можно закрыть */}
        <div className="flex justify-center pt-3" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-hairline-strong" />
        </div>

        <div className="flex items-center justify-between px-5 pt-3 pb-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors duration-[var(--duration-fast)] hover:text-ink active:bg-hairline"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-2">{children}</div>

        {footer ? <div className="px-5 pt-2 pb-safe border-t border-hairline">{footer}</div> : null}
      </div>
    </div>
  );
}
