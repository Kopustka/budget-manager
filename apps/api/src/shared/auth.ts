import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@budget/shared';
import { verifyInitData } from './telegram.js';
import { usersRepository } from '../modules/users/users.repository.js';
import {
  profilesRepository,
  type ProfileScope,
} from '../modules/profiles/profiles.repository.js';
import { UnauthorizedError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
    /** Активный профиль: область видимости всех данных запроса. */
    currentProfile?: ProfileScope;
  }
}

/**
 * preHandler-хук: валидирует Telegram initData из заголовка
 * Authorization: tma <initData>, подставляет пользователя (upsert по Telegram ID)
 * и его активный профиль — область видимости данных для всего запроса.
 */
export async function authenticate(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization ?? '';
  const [scheme, ...rest] = header.split(' ');
  const initData = rest.join(' ');
  if (scheme !== 'tma' || !initData) {
    throw new UnauthorizedError('Ожидается заголовок Authorization: tma <initData>');
  }

  const verified = verifyInitData(initData);
  const user = await usersRepository.upsertByTelegram({
    telegramId: verified.user.id,
    username: verified.user.username ?? null,
    firstName: verified.user.first_name ?? null,
  });
  req.currentUser = user;

  // upsertByTelegram гарантирует активный профиль, поэтому промах здесь означает
  // гонку с удалением, а не обычное состояние — молча продолжать нельзя.
  const profile = await profilesRepository.findActiveScope(user.id);
  if (!profile) throw new UnauthorizedError('Активный профиль не найден');
  req.currentProfile = profile;
}
