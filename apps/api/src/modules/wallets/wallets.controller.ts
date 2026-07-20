import type { FastifyInstance } from 'fastify';
import { MAX_WALLETS, createWalletSchema } from '@budget/shared';
import { authenticate } from '../../shared/auth.js';
import { requireProfile } from '../../shared/current-profile.js';
import { parseOrThrow } from '../../shared/validate.js';
import { ConflictError } from '../../shared/errors.js';
import { cache } from '../../redis/cache.js';
import { walletsRepository } from './wallets.repository.js';

export async function walletsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Кошельки пользователя. Заодно прогреваем быстрый слой балансов. */
  app.get('/wallets', async (req) => {
    const profile = requireProfile(req);
    const wallets = await walletsRepository.listByProfile(profile.id);
    for (const w of wallets) cache.setWalletBalance(profile.id, w.id, w.balance);
    return { items: wallets };
  });

  /** Новый кошелёк. Валюта — пользовательская: разные валюты в балансе не сложатся. */
  app.post('/wallets', async (req, reply) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(createWalletSchema, req.body);

    if ((await walletsRepository.countByProfile(profile.id)) >= MAX_WALLETS) {
      throw new ConflictError(`Больше ${MAX_WALLETS} кошельков не поддерживается`);
    }

    const wallet = await walletsRepository.create(profile.id, input.name, input.balance, profile.currency);
    cache.setWalletBalance(profile.id, wallet.id, wallet.balance);
    return reply.code(201).send(wallet);
  });
}
