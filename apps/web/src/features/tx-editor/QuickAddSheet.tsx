import { useState } from 'react';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { Money } from '@/shared/ui/Money';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useDndStore } from '@/stores/useDndStore';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import { formatRelativeDay } from '@/shared/lib/format';
import { occurredAtFor } from '@/features/dnd-matrix/DndMatrixProvider';
import { cn } from '@/shared/ui/cn';

/**
 * Добавление операции без жеста — через «+» в карусели.
 * Нужен для записи задним числом и как доступная альтернатива Drag-and-Drop
 * (жест мышью/пальцем невозможен при работе с клавиатуры или скринридером).
 */
export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, categories } = useBudgetStore();
  const openOperation = useDndStore((s) => s.openOperation);
  const selectedDay = useUiStore((s) => s.selectedDay);

  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [walletId, setWalletId] = useState<string | null>(null);

  if (!open) return null;

  const activeWalletId = walletId ?? wallets[0]?.id ?? null;
  const options = categories.filter((c) => c.kind === kind);

  function choose(categoryId: string) {
    if (!activeWalletId) return;
    haptics.impact('medium');
    // Дальше — обычная шторка операции: ввод суммы и отправка в DnD-ядро.
    openOperation({
      action: kind === 'income' ? 'deposit' : 'spend',
      walletId: activeWalletId,
      categoryId,
      occurredAt: occurredAtFor(selectedDay),
    });
    onClose();
  }

  return (
    <BottomSheet open title={`Операция за ${formatRelativeDay(occurredAtFor(selectedDay))}`} onClose={onClose}>
      {/* Сегмент-переключатель типа: сразу видно обе опции, не нужен выпадающий список */}
      <div className="flex gap-1 rounded-2xl bg-hairline p-1" role="tablist">
        {(['expense', 'income'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => {
              haptics.selection();
              setKind(value);
            }}
            className={cn(
              'min-h-11 flex-1 rounded-xl text-sm font-medium transition-colors duration-[var(--duration-fast)]',
              kind === value ? 'bg-elevated text-ink' : 'text-ink-muted',
            )}
          >
            {value === 'expense' ? 'Расход' : 'Доход'}
          </button>
        ))}
      </div>

      {wallets.length > 1 && (
        <div className="pt-4">
          <p className="pb-2 text-sm text-ink-muted">Кошелёк</p>
          <div className="flex flex-wrap gap-2">
            {wallets.map((w) => (
              <button
                key={w.id}
                type="button"
                aria-pressed={w.id === activeWalletId}
                onClick={() => {
                  haptics.selection();
                  setWalletId(w.id);
                }}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full px-4 text-sm transition-colors duration-[var(--duration-fast)]',
                  w.id === activeWalletId ? 'bg-brand text-brand-ink' : 'bg-hairline',
                )}
              >
                {w.name}
                <Money value={w.balance} compact className="opacity-80" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="py-4">
        <p className="pb-2 text-sm text-ink-muted">
          {kind === 'expense' ? 'Куда потратили' : 'Источник дохода'}
        </p>
        {options.length === 0 ? (
          <p className="text-sm text-ink-faint">Нет подходящих категорий</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {options.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => choose(c.id)}
                className="glass flex min-h-14 items-center gap-2 rounded-2xl px-3 text-left text-sm transition-transform duration-[var(--duration-fast)] active:scale-[0.98]"
              >
                <CategoryIcon name={c.icon} color={c.color} size={20} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
