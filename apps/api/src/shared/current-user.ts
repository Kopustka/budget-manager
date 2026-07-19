import type { FastifyRequest } from 'fastify';
import type { User } from '@budget/shared';
import { UnauthorizedError } from './errors.js';

/** Пользователь запроса после auth-хука. Бросает 401, если хук не отработал. */
export function requireUser(req: FastifyRequest): User {
  if (!req.currentUser) throw new UnauthorizedError();
  return req.currentUser;
}
