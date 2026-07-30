import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_ICONS, type UpdateCategoryInput } from '@budget/shared';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';
import { CategoryIcon } from '@/shared/ui/CategoryIcon';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useUiStore } from '@/stores/useUiStore';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { toMajor } from '@/shared/lib/format';
import { cn } from '@/shared/ui/cn';
import { parseAmount } from '@/features/tx-editor/AmountField';
import { LimitField } from './LimitField';
import type { CategoryWithStats } from '@/entities/category/api';

interface EditCategorySheetProps {
  category: CategoryWithStats | null;
  onClose: () => void;
}

/**
 * Минорные единицы в строку для поля ввода. Лимита нет — поле пустое.
 * Без разделителей и символа валюты: значение возвращается в тот же input,
 * из которого его разбирает parseAmount.
 */
function limitToInput(limit: number | null): string {
  return limit === null ? '' : String(toMajor(limit));
}

/**
 * Правка категории расхода: название, оформление и запланированный бюджет.
 *
 * Отдельная шторка, а не поля внутри карточки: смена лимита посреди месяца
 * меняет статус категории и может прямо в момент сохранения выдать перерасход —
 * это осознанное действие, у которого должна быть кнопка «Сохранить».
 */
export function EditCategorySheet({ category, onClose }: EditCategorySheetProps) {
  const updateCategory = useBudgetStore((s) => s.updateCategory);
  const deleteCategory = useBudgetStore((s) => s.deleteCategory);
  const notify = useUiStore((s) => s.notify);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(CATEGORY_ICONS[0]);
  const [color, setColor] = useState<string | null>(null);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Форма заполняется текущими значениями при каждом открытии: правка — это
  // изменение того, что есть, а не ввод с нуля.
  useEffect(() => {
    if (!category) return;
    setName(category.name);
    setIcon(category.icon ?? CATEGORY_ICONS[0]);
    setColor(category.color);
    setLimit(limitToInput(category.limit));
    setError(null);
    setConfirmDelete(false);
  }, [category]);

  if (!category) return null;

  // У источника дохода плана расходов не бывает — поле лимита ему не показываем.
  const isExpense = category.kind === 'expense';

  async function submit() {
    if (!category) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название');
      haptics.error();
      return;
    }

    /**
     * Шлём только изменённое — это и есть семантика PATCH.
     *
     * Отправлять форму целиком нельзя: у категорий, заведённых сидом, цвет
     * записан хексом (`#FF9500`), а палитра каталога состоит из CSS-переменных,
     * и такое значение, вернувшись на сервер нетронутым, не проходит валидацию.
     * Заодно не трогаем иконку у категорий, у которых её не было.
     */
    const patch: UpdateCategoryInput = {};
    if (trimmed !== category.name) patch.name = trimmed;
    if (icon !== (category.icon ?? CATEGORY_ICONS[0])) patch.icon = icon;
    if (color !== null && color !== category.color) patch.color = color;
    // Лимит — только у расходов. Для дохода поля нет, и сервер такой patch
    // отклонил бы, поэтому даже не собираем его.
    if (isExpense) {
      // null — явное «снять лимит»: сервер отличает его от отсутствия поля.
      const nextLimit = parseAmount(limit);
      if (nextLimit !== category.limit) patch.limitAmount = nextLimit;
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateCategory(category.id, patch);
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
    if (!category) return;
    // Удаление необратимо — требуем второй тап вместо мгновенного действия.
    if (!confirmDelete) {
      setConfirmDelete(true);
      haptics.warning();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await deleteCategory(category.id);
      haptics.success();
      notify(isExpense ? 'Категория удалена' : 'Источник удалён', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open
      title={isExpense ? 'Настройки категории' : 'Настройки источника'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button
            variant={confirmDelete ? 'danger' : 'secondary'}
            disabled={saving}
            onClick={() => void remove()}
            aria-label={
              confirmDelete
                ? 'Подтвердить удаление'
                : isExpense
                  ? 'Удалить категорию'
                  : 'Удалить источник'
            }
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
      </div>

      {isExpense && (
        <div className="pt-4">
          <LimitField value={limit} onChange={setLimit} />
        </div>
      )}

      {confirmDelete ? (
        <p className="pt-4 text-xs text-danger">
          {isExpense
            ? 'Категория удалится, её операции останутся в истории без категории, а план на месяц сбросится.'
            : 'Источник удалится, его операции останутся в истории без источника.'}
        </p>
      ) : null}

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}
