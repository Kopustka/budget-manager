import { useEffect, useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { useCurrency } from '@/shared/lib/useCurrency';
import { currencyInfo } from '@budget/shared';
import { cn } from '@/shared/ui/cn';
import { AmountField, parseAmount } from '@/features/tx-editor/AmountField';
import { LimitField } from './LimitField';

/** Что создаём. Кошелёк и категории живут в разных таблицах, но форма общая. */
export type EntityKind = 'wallet' | 'expense' | 'income';

const TITLES: Record<EntityKind, string> = {
  wallet: 'Новый кошелёк',
  expense: 'Новая категория расхода',
  income: 'Новый источник дохода',
};

const PLACEHOLDERS: Record<EntityKind, string> = {
  wallet: 'например, Карта',
  expense: 'например, Спорт',
  income: 'например, Подработка',
};

/**
 * Создание кошелька, категории расхода или источника дохода.
 *
 * Иконка и цвет берутся из общего с бэкендом каталога: он валидирует ровно тот
 * список, который здесь показан.
 */
export function CreateEntitySheet({
  kind,
  onClose,
}: {
  kind: EntityKind | null;
  onClose: () => void;
}) {
  const addWallet = useBudgetStore((s) => s.addWallet);
  const addCategory = useBudgetStore((s) => s.addCategory);
  const notify = useUiStore((s) => s.notify);
  const currency = useCurrency();

  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [limit, setLimit] = useState('');
  const [icon, setIcon] = useState<string>(CATEGORY_ICONS[0]);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Каждое открытие — чистая форма: остатки прошлого ввода сбивают с толку.
  useEffect(() => {
    if (kind) {
      setName('');
      setBalance('');
      setLimit('');
      setIcon(kind === 'income' ? 'banknote' : CATEGORY_ICONS[0]);
      setColor(null);
      setError(null);
    }
  }, [kind]);

  if (!kind) return null;

  const isWallet = kind === 'wallet';

  async function submit() {
    if (!kind) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название');
      haptics.error();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (kind === 'wallet') {
        // Пустое поле — это ноль, а не ошибка: кошелёк можно завести пустым.
        await addWallet({ name: trimmed, balance: balance.trim() ? (parseAmount(balance) ?? 0) : 0 });
      } else {
        // Пустое поле бюджета — «без лимита»: отправляем не ноль (он означал бы
        // «тратить нельзя»), а вовсе не отправляем поле.
        const limitAmount = kind === 'expense' ? parseAmount(limit) : null;
        await addCategory({
          name: trimmed,
          kind,
          icon,
          ...(color ? { color } : {}),
          ...(limitAmount !== null ? { limitAmount } : {}),
        });
      }
      haptics.success();
      notify(isWallet ? 'Кошелёк создан' : 'Готово, можно пользоваться', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open
      title={TITLES[kind]}
      onClose={onClose}
      footer={
        <Button full disabled={saving} onClick={() => void submit()}>
          {saving ? 'Создаём…' : 'Создать'}
        </Button>
      }
    >
      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">Название</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={PLACEHOLDERS[kind]}
          maxLength={40}
          className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
        />
      </label>

      {isWallet ? (
        <div className="pt-4">
          <AmountField value={balance} onChange={setBalance} quickAmounts={[]} />
          <p className="pt-2 text-xs text-ink-faint">
            Сколько уже лежит в этом кошельке ({currencyInfo(currency).symbol}). Можно
            оставить пустым — заведётся с нулём.
          </p>
        </div>
      ) : (
        <>
          <div className="pt-4">
            <p className="pb-2 text-sm text-ink-muted">Иконка</p>
            <div className="grid grid-cols-7 gap-1.5">
              {CATEGORY_ICONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Иконка ${value}`}
                  aria-pressed={icon === value}
                  onClick={() => {
                    haptics.selection();
                    setIcon(value);
                  }}
                  className={cn(
                    'grid h-11 place-items-center rounded-xl transition-colors duration-[var(--duration-fast)]',
                    icon === value ? 'bg-brand text-brand-ink' : 'bg-hairline',
                  )}
                >
                  <CategoryIcon name={value} color={icon === value ? 'currentColor' : null} size={20} />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4">
            <p className="pb-2 text-sm text-ink-muted">Цвет</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Цвет ${value}`}
                  aria-pressed={color === value}
                  onClick={() => {
                    haptics.selection();
                    setColor(value);
                  }}
                  className={cn(
                    'h-11 w-11 rounded-full transition-transform duration-[var(--duration-fast)]',
                    color === value ? 'scale-105 ring-2 ring-ink ring-offset-2 ring-offset-canvas' : '',
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <p className="pt-2 text-xs text-ink-faint">
              Не выберете — подставим первый свободный цвет палитры, чтобы на графиках
              категории не слились.
            </p>
          </div>

          {/* План есть только у расходов: у источника дохода лимита не бывает */}
          {kind === 'expense' && (
            <div className="pt-4">
              <LimitField value={limit} onChange={setLimit} />
            </div>
          )}
        </>
      )}

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}
