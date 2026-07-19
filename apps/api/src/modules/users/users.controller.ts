import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Текущий пользователь (создаётся при первом заходе из Telegram). */
  app.get('/me', async (req) => requireUser(req));
}
