/**
 * Слоты категориальной палитры графиков.
 *
 * Цвет закрепляется за категорией по стабильному порядку её создания, а не по
 * месту в рейтинге трат: иначе смена лидера перекрасила бы все остальные
 * сегменты, и читатель, запомнивший «Продукты — синие», был бы обманут.
 * Значения проверены валидатором палитр (полоса светлоты, цветность, CVD, контраст).
 */
export const CHART_SLOTS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
] as const;

/** Хвост распределения («Другое») — намеренно нейтральный, вне слотов. */
export const CHART_REST = 'var(--color-chart-rest)';

/** Больше 6 сегментов на донате не читается — остальное сворачиваем в «Другое». */
export const MAX_SLICES = 6;

/**
 * Карта «категория → слот» по стабильному порядку (порядок создания категорий).
 *
 * Слоты НЕ зациклены: седьмая категория не получает снова цвет первой — иначе
 * две разные категории оказываются одного цвета и легенда врёт. Всё, что за
 * пределами слотов, уходит в «Другое».
 */
export function buildColorMap(stableCategoryIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  stableCategoryIds.slice(0, CHART_SLOTS.length).forEach((id, index) => {
    const slot = CHART_SLOTS[index];
    if (slot) map.set(id, slot);
  });
  return map;
}
