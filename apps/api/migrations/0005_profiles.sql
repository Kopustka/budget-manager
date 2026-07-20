-- Профили бюджета.
--
-- До этой миграции областью видимости бюджета был сам пользователь: кошельки,
-- категории и операции ссылались на users(id). Профиль занимает эту роль, а
-- users остаётся Telegram-личностью с указателем на активный профиль. Поэтому
-- миграция не надстраивает уровень сбоку, а переносит существующую связь:
-- user_id → profile_id, один к одному, без потери данных.
--
-- Валюта и день начала расчётного месяца переезжают на профиль: «Бизнес в
-- долларах» рядом с «Личным в рублях» — основной сценарий нескольких профилей.

CREATE TABLE IF NOT EXISTS profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'RUB',
  month_start_day  SMALLINT NOT NULL DEFAULT 1
                     CHECK (month_start_day BETWEEN 1 AND 28),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- Имена профилей различимы внутри аккаунта: два «Личных» в списке переключения
-- невозможно отличить друг от друга.
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_user_name
  ON profiles (user_id, lower(name));

-- ── Профиль по умолчанию каждому существующему пользователю ──
-- Забирает его текущие валюту и день месяца: после миграции ничего не должно
-- измениться в том, что человек видит на экране.
INSERT INTO profiles (user_id, name, currency, month_start_day, created_at)
SELECT u.id, 'Личный', u.currency, u.month_start_day, u.created_at
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id);

-- ── Активный профиль ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_profile_id UUID
  REFERENCES profiles(id) ON DELETE SET NULL;

UPDATE users u
   SET active_profile_id = p.id
  FROM profiles p
 WHERE p.user_id = u.id AND u.active_profile_id IS NULL;

-- ── Перевод данных на профиль ──
-- Порядок в каждом блоке один: добавить колонку → заполнить → закрепить NOT NULL
-- → пересобрать индексы → убрать старую связь.

-- Кошельки
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS profile_id UUID
  REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE wallets w SET profile_id = p.id FROM profiles p
 WHERE p.user_id = w.user_id AND w.profile_id IS NULL;
ALTER TABLE wallets ALTER COLUMN profile_id SET NOT NULL;

DROP INDEX IF EXISTS idx_wallets_user;
-- Уникальность имени теперь внутри профиля, а не аккаунта: иначе «Наличные»
-- нельзя было бы завести во втором профиле.
DROP INDEX IF EXISTS uq_wallets_user_name;
CREATE INDEX IF NOT EXISTS idx_wallets_profile ON wallets(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_profile_name
  ON wallets (profile_id, lower(name));
ALTER TABLE wallets DROP COLUMN IF EXISTS user_id;

-- Категории
ALTER TABLE categories ADD COLUMN IF NOT EXISTS profile_id UUID
  REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE categories c SET profile_id = p.id FROM profiles p
 WHERE p.user_id = c.user_id AND c.profile_id IS NULL;
ALTER TABLE categories ALTER COLUMN profile_id SET NOT NULL;

DROP INDEX IF EXISTS idx_categories_user;
DROP INDEX IF EXISTS uq_categories_user_kind_name;
CREATE INDEX IF NOT EXISTS idx_categories_profile ON categories(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_profile_kind_name
  ON categories (profile_id, kind, lower(name));
ALTER TABLE categories DROP COLUMN IF EXISTS user_id;

-- Операции
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS profile_id UUID
  REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE transactions t SET profile_id = p.id FROM profiles p
 WHERE p.user_id = t.user_id AND t.profile_id IS NULL;
ALTER TABLE transactions ALTER COLUMN profile_id SET NOT NULL;

DROP INDEX IF EXISTS idx_tx_user_time;
-- Основной индекс под карусель истории: последние операции профиля по времени.
CREATE INDEX IF NOT EXISTS idx_tx_profile_time
  ON transactions(profile_id, occurred_at DESC);
ALTER TABLE transactions DROP COLUMN IF EXISTS user_id;

-- Журнал пересчётов валюты
ALTER TABLE currency_conversions ADD COLUMN IF NOT EXISTS profile_id UUID
  REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE currency_conversions cc SET profile_id = p.id FROM profiles p
 WHERE p.user_id = cc.user_id AND cc.profile_id IS NULL;
ALTER TABLE currency_conversions ALTER COLUMN profile_id SET NOT NULL;

DROP INDEX IF EXISTS idx_currency_conversions_user;
CREATE INDEX IF NOT EXISTS idx_currency_conversions_profile
  ON currency_conversions(profile_id, applied_at DESC);
ALTER TABLE currency_conversions DROP COLUMN IF EXISTS user_id;

-- ── Настройки уехали на профиль ──
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_month_start_day_check;
ALTER TABLE users DROP COLUMN IF EXISTS currency;
ALTER TABLE users DROP COLUMN IF EXISTS month_start_day;
