import type { z } from 'zod';
import { ValidationError } from './errors.js';

/** Разобрать данные zod-схемой, отдав понятную 422-ошибку вместо стектрейса. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new ValidationError(issues);
  }
  return result.data;
}
