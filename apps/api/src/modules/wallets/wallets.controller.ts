import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { cache } from '../../redis/cache.js';
import { walletsRepository } from './wallets.repository.js';

export async function walletsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Кошельки пользователя. Заодно прогреваем быстрый слой балансов. */
  app.get('/wallets', async (req) => {
    const user = requireUser(req);
    const wallets = await walletsRepository.listByUser(user.id);
    for (const w of wallets) cache.setWalletBalance(user.id, w.id, w.balance);
    return { items: wallets };
  });
}
