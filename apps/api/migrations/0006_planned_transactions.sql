-- Планируемые траты: аренда, подписки, абонементы — всё, что списывается по
-- расписанию и потому известно заранее.
--
-- Две таблицы, а не одна, потому что у события есть правило и есть решения по
-- каждой дате. Ежемесячная аренда — это одно правило; материализовать её в
-- строки на годы вперёд значило бы плодить записи, которые никто не спрашивал,
-- и ломать правку суммы задним числом. Экземпляры на ближайшие 30 дней
-- считаются из правила, а в базе лежит только то, что пользователь решил.

CREATE TABLE IF NOT EXISTS planned_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Категория нужна, чтобы подтверждённое списание легло в тот же учёт, что и
  -- ручная трата. SET NULL: удаление категории не должно уносить расписание.
  category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  wallet_id    UUID REFERENCES wallets(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount > 0),

  recurrence   TEXT NOT NULL CHECK (recurrence IN ('once', 'monthly')),
  /** Разовое событие: точная дата. */
  due_date     DATE,
  /**
   * Ежемесячное: число месяца. Потолок 28 — по той же причине, что и у дня
   * начала расчётного периода: 30-го числа в феврале не существует, и событие
   * молча пропадало бы раз в год.
   */
  due_day      SMALLINT CHECK (due_day BETWEEN 1 AND 28),

  /** Выключенное правило остаётся в истории, но больше не порождает событий. */
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT planned_schedule_shape CHECK (
    (recurrence = 'once'    AND due_date IS NOT NULL AND due_day IS NULL) OR
    (recurrence = 'monthly' AND due_day  IS NOT NULL AND due_date IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_planned_profile ON planned_transactions(profile_id, active);

-- Имена различимы внутри профиля: два «VPN» в календаре не отличить друг от друга.
CREATE UNIQUE INDEX IF NOT EXISTS uq_planned_profile_name
  ON planned_transactions (profile_id, lower(name));

/**
 * Решение пользователя по конкретной дате события: подтвердил или пропустил.
 *
 * Ключ (planned_id, due_date) делает подтверждение идемпотентным: повторный тап
 * не создаст вторую трату, а гонка двух запросов упрётся в уникальность, а не
 * спишет деньги дважды.
 */
CREATE TABLE IF NOT EXISTS planned_settlements (
  planned_id     UUID NOT NULL REFERENCES planned_transactions(id) ON DELETE CASCADE,
  due_date       DATE NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('paid', 'skipped')),
  -- Факт, который родился из подтверждения. SET NULL: удалили операцию —
  -- событие остаётся отмеченным, но ссылка на несуществующую строку не висит.
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  settled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (planned_id, due_date)
);
CREATE INDEX IF NOT EXISTS idx_planned_settlements_date
  ON planned_settlements(due_date);
