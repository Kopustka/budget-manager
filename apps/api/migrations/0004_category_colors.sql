-- Цвета категорий: перевод легаси-хексов в токены палитры.
--
-- Сид и ранние версии писали в categories.color системные цвета iOS (#007AFF,
-- #FF9500 и т.п.), а каталог `CATEGORY_COLORS` состоит из CSS-переменных. API
-- валидирует правку категории по каталогу, поэтому такое значение, вернувшись
-- на сервер нетронутым, отклонялось с 422 — категорию нельзя было отредактировать.
--
-- На донат это не влияет: там цвет назначается по порядку создания
-- (buildColorMap), а categories.color красит только иконку категории.

-- Шаг 1. Известные хексы → ближайший токен палитры.
-- Зелёный и красный совпадают с токенами точно; для синего, оранжевого и
-- фиолетового точного соответствия в палитре нет, берём ближайший по тону.
UPDATE categories SET color = CASE color
  WHEN '#34C759' THEN 'var(--color-success)'   -- точное совпадение
  WHEN '#FF3B30' THEN 'var(--color-danger)'    -- точное совпадение
  WHEN '#007AFF' THEN 'var(--color-chart-1)'   -- синий  → синий слот
  WHEN '#FF9500' THEN 'var(--color-chart-4)'   -- оранжевый → янтарный слот
  WHEN '#5856D6' THEN 'var(--color-chart-3)'   -- фиолетовый → пурпурный слот
  ELSE color
END
WHERE color IN ('#34C759', '#FF3B30', '#007AFF', '#FF9500', '#5856D6');

-- Шаг 2. Развести совпавшие цвета и добить всё, что осталось вне каталога.
--
-- Дубликаты внутри (user, kind) были в данных и до перевода: сид раздавал один
-- и тот же хекс разным категориям. Цвет — единственное, чем категории различимы
-- в палитре выбора, поэтому одинаковые разводим.
--
-- Порядок обхода — по created_at: цвет остаётся за той категорией, что появилась
-- раньше, а переезжает более новая. Иначе перекрасилось бы то, к чему пользователь
-- успел привыкнуть.
DO $$
DECLARE
  -- Тот же список и в том же порядке, что CATEGORY_COLORS в packages/shared.
  palette   TEXT[] := ARRAY[
    'var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)',
    'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-6)',
    'var(--color-success)', 'var(--color-danger)'
  ];
  grp       RECORD;
  cat       RECORD;
  used      TEXT[];
  candidate TEXT;
  position  INT;
BEGIN
  FOR grp IN SELECT DISTINCT user_id, kind FROM categories LOOP
    used := ARRAY[]::TEXT[];
    position := 0;

    FOR cat IN
      SELECT id, color FROM categories
       WHERE user_id = grp.user_id AND kind = grp.kind
       ORDER BY created_at, id
    LOOP
      candidate := cat.color;

      IF candidate IS NULL
         OR NOT (candidate = ANY (palette))
         OR candidate = ANY (used)
      THEN
        SELECT p INTO candidate
          FROM unnest(palette) AS p
         WHERE NOT (p = ANY (used))
         LIMIT 1;

        -- Категорий больше, чем цветов (потолок вида — 24, палитра — 8):
        -- зацикливаем её так же, как это делает nextCategoryColor в рантайме.
        IF candidate IS NULL THEN
          candidate := palette[(position % array_length(palette, 1)) + 1];
        END IF;
      END IF;

      IF candidate IS DISTINCT FROM cat.color THEN
        UPDATE categories SET color = candidate WHERE id = cat.id;
      END IF;

      used := used || candidate;
      position := position + 1;
    END LOOP;
  END LOOP;
END $$;
