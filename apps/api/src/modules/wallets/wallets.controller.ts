import type { FastifyInstance } from 'fastify';
import { MAX_WALLETS, createWalletSchema } from '@budget/shared';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { parseOrThrow } from '../../shared/validate.js';
import { ConflictError } from '../../shared/errors.js';
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

  /** Новый кошелёк. Валюта — пользовательская: разные валюты в балансе не сложатся. */
  app.post('/wallets', async (req, reply) => {
    const user = requireUser(req);
    const input = parseOrThrow(createWalletSchema, req.body);

    if ((await walletsRepository.countByUser(user.id)) >= MAX_WALLETS) {
      throw new ConflictError(`Больше ${MAX_WALLETS} кошельков не поддерживается`);
    }

    const wallet = await walletsRepository.create(user.id, input.name, input.balance, user.currency);
    cache.setWalletBalance(user.id, wallet.id, wallet.balance);
    return reply.code(201).send(wallet);
  });
}
