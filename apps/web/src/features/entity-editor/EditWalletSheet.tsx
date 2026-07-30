import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { UpdateWalletInput, Wallet } from '@budget/shared';
import { currencyInfo } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { formatMoney, toMajor } from '@/shared/lib/format';
import { useCurrency } from '@/shared/lib/useCurrency';
import { AmountField, parseAmount } from '@/features/tx-editor/AmountField';

interface EditWalletSheetProps {
  wallet: Wallet | null;
  onClose: () => void;
}

/** Баланс в минорных единицах — в строку для поля ввода, без разделителей. */
function balanceToInput(balance: number): string {
  return String(toMajor(balance));
}

/**
 * Правка кошелька: название и коррекция баланса.
 *
 * Баланс здесь задаётся абсолютным числом — это «сколько на самом деле лежит»,
 * ручная сверка с реальностью, а не операция. Проведи мы его тратой/зачислением,
 * в истории появилась бы фантомная запись; поэтому баланс правится напрямую, и
 * подпись об этом честно предупреждает.
 */
export function EditWalletSheet({ wallet, onClose }: EditWalletSheetProps) {
  const updateWallet = useBudgetStore((s) => s.updateWallet);
  const deleteWallet = useBudgetStore((s) => s.deleteWallet);
  const notify = useUiStore((s) => s.notify);
  const currency = useCurrency();

  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Форма заполняется текущими значениями при каждом открытии.
  useEffect(() => {
    if (!wallet) return;
    setName(wallet.name);
    setBalance(balanceToInput(wallet.balance));
    setError(null);
    setConfirmDelete(false);
  }, [wallet]);

  if (!wallet) return null;

  async function submit() {
    if (!wallet) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название');
      haptics.error();
      return;
    }

    // Шлём только изменённое — семантика PATCH. Пустое поле баланса трактуем
    // как ноль (как и при создании), а не как «не трогать».
    const patch: UpdateWalletInput = {};
    if (trimmed !== wallet.name) patch.name = trimmed;
    const nextBalance = parseAmount(balance) ?? 0;
    if (nextBalance !== wallet.balance) patch.balance = nextBalance;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateWallet(wallet.id, patch);
      haptics.success();
      notify('Изменения сохранены', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!wallet) return;
    // Удаление необратимо и уносит баланс из общего итога — требуем второй тап.
    if (!confirmDelete) {
      setConfirmDelete(true);
      haptics.warning();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await deleteWallet(wallet.id);
      haptics.success();
      notify('Кошелёк удалён', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить кошелёк');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open
      title="Настройки кошелька"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button
            variant={confirmDelete ? 'danger' : 'secondary'}
            disabled={saving}
            onClick={() => void remove()}
            aria-label={confirmDelete ? 'Подтвердить удаление кошелька' : 'Удалить кошелёк'}
          >
            <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
            {confirmDelete ? 'Точно удалить' : ''}
          </Button>
          <Button full disabled={saving} onClick={() => void submit()}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      }
    >
      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">Название</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
        />
      </label>

      <div className="pt-4">
        <AmountField value={balance} onChange={setBalance} quickAmounts={[]} />
        <p className="pt-2 text-xs text-ink-faint">
          Сколько сейчас лежит в кошельке ({currencyInfo(currency).symbol}). Это ручная
          сверка с реальностью — операция в историю не попадёт.
        </p>
      </div>

      {confirmDelete ? (
        <p className="pt-4 text-xs text-danger">
          Кошелёк удалится, а его операции останутся в истории без кошелька.{' '}
          {wallet.balance > 0 ? (
            <>
              Баланс {formatMoney(wallet.balance, currency)} перестанет учитываться в общем итоге.
            </>
          ) : null}
        </p>
      ) : null}

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}
