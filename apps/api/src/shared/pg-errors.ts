import { ConflictError } from './errors.js';

/** Код нарушения уникального индекса в PostgreSQL. */
const UNIQUE_VIOLATION = '23505';

/**
 * Превращает нарушение уникальности в понятный 409.
 *
 * Проверять занятость имени отдельным SELECT бессмысленно: между проверкой и
 * вставкой параллельный запрос успеет создать такую же запись. Поэтому
 * полагаемся на индекс и переводим его ошибку в текст для пользователя.
 */
export function asDuplicateError(err: unknown, message: string): unknown {
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION) {
    return new ConflictError(message);
  }
  return err;
}
