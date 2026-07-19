-- Настройки пользователя: валюта и день начала расчётного месяца.

-- Валюта хранится на пользователе; кошельки наследуют её значение.
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'RUB';

-- День начала периода. Ограничение 28 — чтобы период существовал в феврале.
-- Значение по умолчанию 1 сохраняет прежнее поведение (календарный месяц).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS month_start_day SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_month_start_day_check;
ALTER TABLE users
  ADD CONSTRAINT users_month_start_day_check CHECK (month_start_day BETWEEN 1 AND 28);

-- Пересчёт валюты необратим, поэтому каждый прогон фиксируем: по этой таблице
-- видно, каким курсом и когда были умножены суммы.
CREATE TABLE IF NOT EXISTS currency_conversions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_currency  TEXT NOT NULL,
  to_currency    TEXT NOT NULL,
  -- Курс: сколько единиц новой валюты в одной единице старой.
  rate           NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
  wallets_count       INTEGER NOT NULL DEFAULT 0,
  transactions_count  INTEGER NOT NULL DEFAULT 0,
  limits_count        INTEGER NOT NULL DEFAULT 0,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_currency_conversions_user
  ON currency_conversions(user_id, applied_at DESC);
