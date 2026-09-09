-- Перевод денег между кошельками: жест «кошелёк → кошелёк» в матрице.
--
-- Одна строка, а не пара «списание + зачисление». Пара выглядела бы проще, но
-- сломала бы учёт: totalsRange считает доходы и расходы по type, и перевод с
-- карты на наличные раздул бы обе колонки на ровном месте, хотя денег в бюджете
-- не прибавилось и не убавилось. Одна строка с двумя кошельками остаётся
-- невидимой для всех выборок, которые фильтруют по 'spend'/'deposit', и при
-- этом откатывается целиком — без риска удалить половину перевода.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'spend', 'transfer'));

-- Кошелёк-получатель. SET NULL по тем же соображениям, что и wallet_id:
-- удаление кошелька не должно уносить историю переводов.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS to_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL;

-- Форма строки: у перевода нет категории, у остальных типов нет второго кошелька.
--
-- Требовать «у перевода to_wallet_id NOT NULL» здесь нельзя: ON DELETE SET NULL
-- выполняет UPDATE, CHECK перепроверяется на каждом UPDATE — и удаление кошелька
-- падало бы с ошибкой вместо того, чтобы осиротить историю.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transfer_shape;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_transfer_shape CHECK (
    (type =  'transfer' AND category_id  IS NULL) OR
    (type <> 'transfer' AND to_wallet_id IS NULL)
  );

-- Перевод самому себе — не операция, а промах пальцем. NULL-ы пропускаем:
-- после удаления кошелька сравнивать уже нечего.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transfer_distinct;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_transfer_distinct CHECK (
    to_wallet_id IS NULL OR wallet_id IS NULL OR to_wallet_id <> wallet_id
  );

-- История кошелька должна находить и входящие переводы, а не только исходящие.
CREATE INDEX IF NOT EXISTS idx_tx_to_wallet ON transactions(to_wallet_id);
