import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  CURRENCIES,
  MAX_MONTH_START_DAY,
  MAX_PROFILES,
  currencyInfo,
  type Profile,
} from '@budget/shared';
import { useProfileStore } from '@/stores/useProfileStore';
import { useUiStore } from '@/stores/useUiStore';
import { GlassCard } from '@/shared/ui/GlassCard';
import { Button } from '@/shared/ui/Button';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { ApiError } from '@/shared/api/client';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';

/**
 * Профили бюджета: переключение, создание, переименование и удаление.
 *
 * У каждого профиля свои кошельки, категории, операции и валюта — поэтому в
 * списке видно и валюту тоже: без неё два профиля с похожими именами не
 * различить, а переключение меняет все суммы на экране.
 */
export function ProfilesSection() {
  const { items, activeId, switching, load, activate } = useProfileStore();
  const notify = useUiStore((s) => s.notify);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  useEffect(() => {
    if (items.length === 0) void load();
  }, [items.length, load]);

  async function switchTo(profile: Profile) {
    if (profile.id === activeId || switching) return;
    haptics.selection();
    try {
      await activate(profile.id);
      haptics.success();
      notify(`Профиль «${profile.name}»`, 'success');
    } catch (err) {
      haptics.error();
      notify(err instanceof ApiError ? err.message : 'Не удалось переключить', 'error');
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {items.map((profile) => {
          const isActive = profile.id === activeId;
          return (
            <GlassCard key={profile.id} highlighted={isActive} className="flex items-center gap-3">
              <button
                type="button"
                aria-pressed={isActive}
                disabled={switching}
                onClick={() => void switchTo(profile)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    'grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-semibold',
                    isActive ? 'bg-brand text-brand-ink' : 'bg-hairline text-ink-muted',
                  )}
                >
                  {isActive ? (
                    <Check size={20} strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    currencyInfo(profile.currency).symbol
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{profile.name}</span>
                  <span className="text-xs text-ink-faint">
                    {profile.currency}
                    {profile.monthStartDay !== 1 ? ` · с ${profile.monthStartDay} числа` : ''}
                    {isActive ? ' · открыт' : ''}
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-label={`Настроить профиль ${profile.name}`}
                onClick={() => {
                  haptics.selection();
                  setEditing(profile);
                }}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink-muted transition-colors duration-[var(--duration-fast)] active:bg-hairline"
              >
                <Pencil size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </GlassCard>
          );
        })}

        {items.length < MAX_PROFILES && (
          <button
            type="button"
            onClick={() => {
              haptics.selection();
              setCreating(true);
            }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline-strong py-3 text-sm text-ink-muted transition-colors duration-[var(--duration-fast)] active:bg-hairline"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Новый профиль
          </button>
        )}
      </div>

      <CreateProfileSheet open={creating} onClose={() => setCreating(false)} />
      <EditProfileSheet profile={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Создание профиля: имя обязательно, валюта и начало месяца — с умолчаниями. */
function CreateProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useProfileStore((s) => s.create);
  const active = useProfileStore((s) => s.items.find((p) => p.id === s.activeId));
  const notify = useUiStore((s) => s.notify);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [monthStartDay, setMonthStartDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCurrency(null);
    setMonthStartDay(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  const effectiveCurrency = currency ?? active?.currency ?? 'RUB';
  const effectiveDay = monthStartDay ?? active?.monthStartDay ?? 1;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название');
      haptics.error();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await create({
        name: trimmed,
        currency: effectiveCurrency,
        monthStartDay: effectiveDay,
      });
      haptics.success();
      notify(`Профиль «${trimmed}» создан и открыт`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать профиль');
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open
      title="Новый профиль"
      onClose={onClose}
      footer={
        <Button full disabled={saving} onClick={() => void submit()}>
          {saving ? 'Создаём…' : 'Создать и открыть'}
        </Button>
      }
    >
      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">Название</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="например, Бизнес"
          maxLength={40}
          className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none placeholder:text-ink-faint"
        />
      </label>

      <div className="pt-4">
        <p className="pb-2 text-sm text-ink-muted">Валюта</p>
        <div className="grid grid-cols-4 gap-1.5">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              aria-pressed={effectiveCurrency === c.code}
              onClick={() => {
                haptics.selection();
                setCurrency(c.code);
              }}
              className={cn(
                'grid h-11 place-items-center rounded-xl text-sm transition-colors duration-[var(--duration-fast)]',
                effectiveCurrency === c.code
                  ? 'bg-brand font-semibold text-brand-ink'
                  : 'bg-hairline',
              )}
            >
              {c.code}
            </button>
          ))}
        </div>
        {/* Пересчёта здесь не бывает: профиль пустой, пересчитывать нечего */}
        <p className="pt-2 text-xs text-ink-faint">
          У профиля своя валюта — суммы других профилей она не затрагивает.
        </p>
      </div>

      <div className="pt-4">
        <p className="pb-2 text-sm text-ink-muted">Начало расчётного месяца</p>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1).map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={day === effectiveDay}
              onClick={() => {
                haptics.selection();
                setMonthStartDay(day);
              }}
              className={cn(
                'tabular grid h-10 place-items-center rounded-xl text-sm transition-colors duration-[var(--duration-fast)]',
                day === effectiveDay ? 'bg-brand font-semibold text-brand-ink' : 'bg-hairline',
              )}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}

/**
 * Переименование и удаление.
 *
 * Удаление уносит все операции профиля и необратимо, поэтому идёт в два шага:
 * первый тап только раскрывает предупреждение с именем профиля, и лишь второй
 * удаляет. Тем же приёмом защищено удаление операции.
 */
function EditProfileSheet({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const { rename, remove, items } = useProfileStore();
  const notify = useUiStore((s) => s.notify);

  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setConfirmingDelete(false);
    setError(null);
  }, [profile]);

  if (!profile) return null;

  const isLast = items.length <= 1;

  async function save() {
    if (!profile) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Введите название');
      haptics.error();
      return;
    }
    if (trimmed === profile.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rename(profile.id, trimmed);
      haptics.success();
      notify('Профиль переименован', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!profile) return;
    if (!confirmingDelete) {
      haptics.impact('medium');
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    try {
      await remove(profile.id);
      haptics.success();
      notify(`Профиль «${profile.name}» удалён`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      title="Настройки профиля"
      onClose={onClose}
      footer={
        <Button full disabled={busy} onClick={() => void save()}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      }
    >
      <label className="block text-sm">
        <span className="block pb-1 text-ink-muted">Название</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="w-full rounded-2xl bg-hairline px-4 py-3 outline-none"
        />
      </label>

      <p className="pt-3 text-xs text-ink-faint">
        Валюта и начало месяца меняются в разделах выше — они относятся к открытому профилю.
      </p>

      <div className="mt-5 border-t border-hairline pt-4">
        {isLast ? (
          <p className="text-xs text-ink-faint">
            Это единственный профиль — удалить его нельзя, приложению нечего будет открыть.
          </p>
        ) : (
          <>
            {confirmingDelete && (
              <p className="pb-3 text-sm text-danger">
                Удалить «{profile.name}» вместе со всеми кошельками, категориями и операциями?
                Это необратимо.
              </p>
            )}
            <Button
              full
              variant={confirmingDelete ? 'danger' : 'secondary'}
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
              {confirmingDelete ? 'Да, удалить навсегда' : 'Удалить профиль'}
            </Button>
          </>
        )}
      </div>

      {error ? <p className="pt-3 text-sm text-danger">{error}</p> : null}
    </BottomSheet>
  );
}
