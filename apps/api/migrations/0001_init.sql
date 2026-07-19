-- Budget Manager — начальная схема (source of truth).
-- Денежные суммы: BIGINT, минорные единицы (копейки). Без float.

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id  BIGINT NOT NULL UNIQUE,
  username     TEXT,
  first_name   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  balance     BIGINT NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'RUB',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  icon        TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

CREATE TABLE IF NOT EXISTS category_limits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period        TEXT NOT NULL, -- YYYY-MM
  limit_amount  BIGINT NOT NULL CHECK (limit_amount >= 0),
  UNIQUE (category_id, period)
);

CREATE TABLE IF NOT EXISTS transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('deposit', 'spend')),
  wallet_id    UUID REFERENCES wallets(id) ON DELETE SET NULL,
  category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  subcategory  TEXT,
  amount       BIGINT NOT NULL CHECK (amount > 0),
  comment      TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Основной индекс под карусель истории: последние транзакции юзера по времени.
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
