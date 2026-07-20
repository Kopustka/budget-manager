import type { FastifyRequest } from 'fastify';
import type { User } from '@budget/shared';
import type { ProfileScope } from '../modules/profiles/profiles.repository.js';
import { UnauthorizedError } from './errors.js';

/** Пользователь запроса после auth-хука. Бросает 401, если хук не отработал. */
export function requireUser(req: FastifyRequest): User {
  if (!req.currentUser) throw new UnauthorizedError();
  return req.currentUser;
}

/**
 * Активный профиль запроса — область видимости данных.
 *
 * Именно его, а не пользователя, спрашивают обработчики: кошельки, категории и
 * операции принадлежат профилю, и запрос обязан работать ровно с одним.
 */
export function requireProfile(req: FastifyRequest): ProfileScope {
  if (!req.currentProfile) throw new UnauthorizedError();
  return req.currentProfile;
}
