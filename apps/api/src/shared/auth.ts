import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@budget/shared';
import { verifyInitData } from './telegram.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { UnauthorizedError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
  }
}

/**
 * preHandler-хук: валидирует Telegram initData из заголовка Authorization: tma <initData>
 * и подставляет пользователя (upsert по Telegram ID) в request.currentUser.
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
  req.currentUser = await usersRepository.upsertByTelegram({
    telegramId: verified.user.id,
    username: verified.user.username ?? null,
    firstName: verified.user.first_name ?? null,
  });
}
