/**
 * Правила Drag-and-Drop матрицы. Единый источник истины для фронтенда и бэкенда.
 *
 *   Доход   -> Кошелёк = Зачисление (income -> wallet)
 *   Кошелёк -> Расход  = Списание   (wallet -> expense)
 *   Кошелёк -> Кошелёк = Перевод    (wallet -> wallet)
 *   Доход   -> Расход  = ЗАПРЕЩЕНО  (пружина назад + haptic error)
 */

export const NODE_KINDS = ['income', 'wallet', 'expense'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const DND_ACTIONS = ['deposit', 'spend', 'transfer'] as const;
export type DndAction = (typeof DND_ACTIONS)[number];

export interface MatrixResult {
  allowed: boolean;
  action: DndAction | null;
  /** Требуется ли Bottom Sheet для ввода суммы/комментария */
  requiresInput: boolean;
  reason?: string;
}

/**
 * Разрешает перетаскивание source -> target и возвращает семантику операции.
 */
export function resolveMatrix(source: NodeKind, target: NodeKind): MatrixResult {
  // Доход -> Кошелёк = Зачисление
  if (source === 'income' && target === 'wallet') {
    return { allowed: true, action: 'deposit', requiresInput: true };
  }
  // Кошелёк -> Расход = Списание
  if (source === 'wallet' && target === 'expense') {
    return { allowed: true, action: 'spend', requiresInput: true };
  }
  // Кошелёк -> Кошелёк = Перевод. Совпадение кошельков здесь не ловится:
  // матрица знает только виды узлов, поэтому «сам в себя» отсекают вызывающие.
  if (source === 'wallet' && target === 'wallet') {
    return { allowed: true, action: 'transfer', requiresInput: true };
  }
  // Доход -> Расход = запрещено
  if (source === 'income' && target === 'expense') {
    return {
      allowed: false,
      action: null,
      requiresInput: false,
      reason: 'Нельзя тратить доход напрямую — сначала зачисли в кошелёк',
    };
  }
  // Всё остальное — не поддерживается
  return {
    allowed: false,
    action: null,
    requiresInput: false,
    reason: `Недопустимое перетаскивание: ${source} → ${target}`,
  };
}
