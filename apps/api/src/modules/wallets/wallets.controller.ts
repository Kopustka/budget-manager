import type { FastifyInstance } from 'fastify';
import { MAX_WALLETS, createWalletSchema, updateWalletSchema } from '@budget/shared';
import { pool } from '../../config/db.js';
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

  /**
   * Правка кошелька: название и/или коррекция баланса.
   *
   * findOwned до update — чтобы чужой id вернул 404, а не молча ничего не
   * обновил. Баланс задаётся абсолютным значением, поэтому после записи просто
   * перегреваем быстрый слой новым числом.
   */
  app.patch<{ Params: { id: string } }>('/wallets/:id', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(updateWalletSchema, req.body);
    await walletsRepository.findOwned(pool, profile.id, req.params.id);

    const wallet = await walletsRepository.update(profile.id, req.params.id, input);
    cache.setWalletBalance(profile.id, wallet.id, wallet.balance);
    return wallet;
  });

  /**
   * Удаление кошелька. Операции по нему остаются в истории без кошелька
   * (wallet_id → NULL), а его баланс перестаёт учитываться в общем итоге.
   */
  app.delete<{ Params: { id: string } }>('/wallets/:id', async (req, reply) => {
    const profile = requireProfile(req);
    await walletsRepository.remove(profile.id, req.params.id);
    cache.clearWalletBalance(profile.id, req.params.id);
    return reply.code(204).send();
  });
}
