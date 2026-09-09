import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Transaction } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { ApiError } from '@/shared/api/client';
import { transactionApi } from '@/entities/transaction/api';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import { formatRelativeDay, formatTime, toMajor } from '@/shared/lib/format';
import { transferLabel } from '@/shared/lib/transfer';
import { AmountField, parseAmount } from './AmountField';
import { cn } from '@/shared/ui/cn';

interface EditTransactionSheetProps {
  transaction: Transaction | null;
  onClose: () => void;
}

/** Правка операции: сумма, подкатегория, комментарий, перепривязка категории, удаление. */
export function EditTransactionSheet({ transaction, onClose }: EditTransactionSheetProps) {
  const { categories, wallets, applyEditResult, applyRemoval } = useBudgetStore();
  const notify = useUiStore((s) => s.notify);

  const [amount, setAmount] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [comment, setComment] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Каждое открытие начинается с актуальных значений операции.
  useEffect(() => {
    if (!transaction) return;
    setAmount(String(toMajor(transaction.amount)));
    setSubcategory(transaction.subcategory ?? '');
    setComment(transaction.comment ?? '');
    setCategoryId(transaction.categoryId);
    setError(null);
    setConfirmDelete(false);
  }, [transaction]);

  if (!transaction) return null;

  const isDeposit = transaction.type === 'deposit';
  const isTransfer = transaction.type === 'transfer';
  // Перепривязывать можно только в пределах своего типа: расход к расходу, доход к доходу.
  const options = categories.filter((c) => c.kind === (isDeposit ? 'income' : 'expense'));

  async function save() {
    if (!transaction) return;
    const minor = parseAmount(amount);
    if (minor === null) {
      setError('Введите сумму больше нуля');
      haptics.error();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await transactionApi.edit(transaction.id, {
        amount: minor,
        // У перевода нет ни категории, ни подкатегории — бэкенд их и не примет.
        subcategory: isTransfer ? null : subcategory.trim() || null,
        comment: comment.trim() || null,
        categoryId: isTransfer ? undefined : categoryId ?? undefined,
      });
      applyEditResult(result);
      if (result.isOverdraft) {
        haptics.error();
        notify('После правки план категории превышен', 'error');
      } else {
        haptics.success();
        notify('Сохранено', 'success');
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить правку');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!transaction) return;
    // Удаление необратимо, поэтому требуем второй тап вместо мгновенного действия.
    if (!confirmDelete) {
      setConfirmDelete(true);
      haptics.warning();
      return;
    }

    setBusy(true);
    try {
      const { walletBalance, toWalletBalance } = await transactionApi.remove(transaction.id);
      await applyRemoval(transaction.id, walletBalance, toWalletBalance);
      haptics.success();
      notify(isTransfer ? 'Перевод отменён' : 'Операция удалена', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить операцию');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      title={isTransfer ? 'Правка перевода' : isDeposit ? 'Правка зачисления' : 'Правка списания'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button
            variant={confirmDelete ? 'danger' : 'secondary'}
            disabled={busy}
            onClick={() => void remove()}
            aria-label={confirmDelete ? 'Подтвердить удаление' : 'Удалить операцию'}
          >
            <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
            {confirmDelete ? 'Точно удалить' : ''}
          </Button>
          <Button full disabled={busy} onClick={() => void save()}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      }
    >
      <p className="pb-3 text-xs text-ink-faint">
        {formatRelativeDay(transaction.occurredAt)}, {formatTime(transaction.occurredAt)}
        {/* Маршрут перевода заменяет категорию: без него из шторки не понять,
            между какими кошельками правится сумма. */}
        {isTransfer ? ` · ${transferLabel(transaction, wallets)}` : ''}
      </p>

      <AmountField value={amount} onChange={setAmount} error={error} />

      {!isTransfer && (
      <div className="pt-4">
        <p className="pb-2 text-sm text-ink-muted">Категория</p>
        <div className="flex flex-wrap gap-2">
          {options.map((c) => {
            const active = c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  haptics.selection();
                  setCategoryId(c.id);
                }}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full px-4 text-sm',
                  'transition-colors duration-[var(--duration-fast)]',
                  active ? 'bg-brand text-brand-ink' : 'bg-hairline text-ink',
                )}
              >
                <CategoryIcon
                  name={c.icon}
                  color={active ? 'currentColor' : c.color}
                  size={16}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div className="flex flex-col gap-3 py-4">
        {!isDeposit && !isTransfer && (
          <label className="block text-sm">
            <span className="block pb-1 text-ink-muted">Подкатегория</span>
            <input
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
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
            maxLength={280}
            className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
    </BottomSheet>
  );
}
