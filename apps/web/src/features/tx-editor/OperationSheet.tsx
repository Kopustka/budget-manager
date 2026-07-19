import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { ApiError } from '@/shared/api/client';
import { transactionApi } from '@/entities/transaction/api';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useDndStore } from '@/stores/useDndStore';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import { formatRelativeDay } from '@/shared/lib/format';
import { AmountField, parseAmount } from './AmountField';

/**
 * Шторка подтверждения операции матрицы: сумма, подкатегория, комментарий.
 * Открывается после того, как жест признан допустимым, и она же отправляет
 * событие в DnD-ядро бэкенда.
 */
export function OperationSheet() {
  const pending = useDndStore((s) => s.pending);
  const closeOperation = useDndStore((s) => s.closeOperation);
  const { wallets, categories, applyDndResult } = useBudgetStore();
  const notify = useUiStore((s) => s.notify);

  const [amount, setAmount] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!pending) return null;

  const wallet = wallets.find((w) => w.id === pending.walletId);
  const category = categories.find((c) => c.id === pending.categoryId);
  const isDeposit = pending.action === 'deposit';

  function close() {
    setAmount('');
    setSubcategory('');
    setComment('');
    setError(null);
    closeOperation();
  }

  async function submit() {
    if (!pending) return;
    const minor = parseAmount(amount);
    if (minor === null) {
      setError('Введите сумму больше нуля');
      haptics.error();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await transactionApi.dnd({
        source: isDeposit ? 'income' : 'wallet',
        target: isDeposit ? 'wallet' : 'expense',
        walletId: pending.walletId,
        categoryId: pending.categoryId,
        amount: minor,
        subcategory: subcategory.trim() || null,
        comment: comment.trim() || null,
        occurredAt: pending.occurredAt,
      });

      applyDndResult(result);

      // Овердрафт — не ошибка операции, но пользователь обязан её заметить.
      if (result.isOverdraft) {
        haptics.error();
        notify(`Лимит категории «${category?.name ?? ''}» превышен`, 'error');
      } else {
        haptics.success();
        notify(isDeposit ? 'Зачислено' : 'Списано', 'success');
      }
      close();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Не удалось сохранить операцию';
      setError(message);
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open
      title={isDeposit ? 'Зачисление' : 'Списание'}
      onClose={close}
      footer={
        <Button full disabled={saving} onClick={() => void submit()}>
          {saving ? 'Сохраняем…' : isDeposit ? 'Зачислить' : 'Списать'}
        </Button>
      }
    >
      {/* Маршрут операции: откуда и куда идут деньги — снимает неоднозначность жеста */}
      <div className="flex items-center gap-2 pb-4 text-sm">
        <span className="glass flex min-h-11 flex-1 items-center gap-2 rounded-2xl px-3">
          {isDeposit ? (
            <>
              <CategoryIcon name={category?.icon ?? null} color={category?.color} size={18} />
              <span className="truncate">{category?.name ?? 'Доход'}</span>
            </>
          ) : (
            <span className="truncate">{wallet?.name ?? 'Кошелёк'}</span>
          )}
        </span>
        <ArrowRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-faint" aria-label="в" />
        <span className="glass flex min-h-11 flex-1 items-center gap-2 rounded-2xl px-3">
          {isDeposit ? (
            <span className="truncate">{wallet?.name ?? 'Кошелёк'}</span>
          ) : (
            <>
              <CategoryIcon name={category?.icon ?? null} color={category?.color} size={18} />
              <span className="truncate">{category?.name ?? 'Категория'}</span>
            </>
          )}
        </span>
      </div>

      <p className="pb-3 text-xs text-ink-faint">
        Дата: {formatRelativeDay(pending.occurredAt)}
        {wallet ? (
          <>
            {' · '}Баланс: <Money value={wallet.balance} className="text-ink-muted" />
          </>
        ) : null}
      </p>

      <AmountField value={amount} onChange={setAmount} autoFocus error={error} />

      <div className="flex flex-col gap-3 py-4">
        {!isDeposit && (
          <label className="block text-sm">
            <span className="block pb-1 text-ink-muted">Подкатегория</span>
            <input
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="например, молочка"
              maxLength={64}
              className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="block pb-1 text-ink-muted">Комментарий</span>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="необязательно"
            maxLength={280}
            className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
    </BottomSheet>
  );
}
