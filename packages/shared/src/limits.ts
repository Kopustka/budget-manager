/**
 * Планирование расходов: пороги статуса категории по её месячному лимиту.
 *
 * Пороги живут здесь, а не в CSS-классах и не в SQL: статус нужен одинаковый
 * фронту (перекрасить карточку), бэкенду (решить, слать ли пуш) и аналитике.
 * Разъехавшиеся копии «85%» дали бы карточку в предупреждении без уведомления.
 */

/** Доля лимита, с которой категория считается пограничной. */
export const LIMIT_WARNING_RATIO = 0.85;

/** Доля лимита, с которой категория считается исчерпанной. */
export const LIMIT_EXCEEDED_RATIO = 1;

/**
 * NONE — лимит не задан: это не «всё хорошо», а «плана нет», и выглядеть
 * такая карточка должна нейтрально, без зелёного прогресса.
 */
export type LimitStatus = 'NONE' | 'SAFE' | 'WARNING' | 'EXCEEDED';

/**
 * Доля израсходованного лимита (0..∞). Без лимита доли не существует — null.
 * Нулевой лимит не превращаем в деление на ноль: это «запрет тратить»,
 * поэтому любая трата по нему сразу исчерпание.
 */
export function limitRatio(spent: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return spent > 0 ? 1 : 0;
  return spent / limit;
}

/**
 * Статус категории.
 *
 * Граница EXCEEDED — «потрачено не меньше лимита» (>= 100%), а не «больше»:
 * ровно исчерпанный лимит означает, что тратить больше нельзя, и пользователь
 * должен увидеть это до того, как уйдёт в минус.
 */
export function limitStatus(spent: number, limit: number | null): LimitStatus {
  const ratio = limitRatio(spent, limit);
  if (ratio === null) return 'NONE';
  if (ratio >= LIMIT_EXCEEDED_RATIO) return 'EXCEEDED';
  if (ratio >= LIMIT_WARNING_RATIO) return 'WARNING';
  return 'SAFE';
}

/** Остаток лимита; отрицательное значение — перерасход. null, если лимита нет. */
export function limitRest(spent: number, limit: number | null): number | null {
  return limit === null ? null : limit - spent;
}
