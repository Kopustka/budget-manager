import type { FastifyInstance } from 'fastify';
import { MAX_PROFILES, createProfileSchema, updateProfileSchema } from '@budget/shared';
import { pool } from '../../config/db.js';
import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../shared/auth.js';
import { requireProfile, requireUser } from '../../shared/current-profile.js';
import { parseOrThrow } from '../../shared/validate.js';
import { ConflictError } from '../../shared/errors.js';
import { profilesRepository } from './profiles.repository.js';

/**
 * Удалить производный кэш профиля.
 *
 * Нужен при удалении: ключи Redis переживут строку в PostgreSQL, а UUID хоть и
 * не повторяется, мусор копился бы вечно. Данные здесь только производные —
 * терять нечего.
 */
async function dropProfileCache(profileId: string): Promise<void> {
  const keys = await redis.keys(`${env.REDIS_NAMESPACE}:profile:${profileId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Профили аккаунта и указатель на активный. */
  app.get('/profiles', async (req) => {
    const user = requireUser(req);
    return {
      activeProfileId: user.activeProfileId,
      items: await profilesRepository.listByUser(user.id),
    };
  });

  /**
   * Новый профиль. Валюту и день месяца не спрашиваем обязательно: по умолчанию
   * наследуем от текущего — чаще всего заводят второй бюджет в той же валюте.
   */
  app.post('/profiles', async (req, reply) => {
    const user = requireUser(req);
    const active = requireProfile(req);
    const input = parseOrThrow(createProfileSchema, req.body);

    const existing = await profilesRepository.listByUser(user.id);
    if (existing.length >= MAX_PROFILES) {
      throw new ConflictError(`Больше ${MAX_PROFILES} профилей не поддерживается`);
    }

    const profile = await profilesRepository.create(user.id, {
      name: input.name,
      currency: input.currency ?? active.currency,
      monthStartDay: input.monthStartDay ?? active.monthStartDay,
    });
    return reply.code(201).send(profile);
  });

  /** Переименование. */
  app.patch<{ Params: { id: string } }>('/profiles/:id', async (req) => {
    const user = requireUser(req);
    const input = parseOrThrow(updateProfileSchema, req.body);
    return profilesRepository.rename(user.id, req.params.id, input.name);
  });

  /** Переключиться на профиль: с этого момента все запросы идут в его область. */
  app.post<{ Params: { id: string } }>('/profiles/:id/activate', async (req) => {
    const user = requireUser(req);
    // Проверяем принадлежность до записи: иначе чужой UUID стал бы активным
    // и следующий запрос показал бы чужие данные.
    const profile = await profilesRepository.findOwned(pool, user.id, req.params.id);
    await profilesRepository.setActive(user.id, profile.id);
    return profile;
  });

  /**
   * Удаление профиля вместе со всеми его данными.
   *
   * Ответ содержит нового активного: интерфейс должен знать, что открывать,
   * когда удалили тот профиль, в котором находился пользователь.
   */
  app.delete<{ Params: { id: string } }>('/profiles/:id', async (req) => {
    const user = requireUser(req);
    const removed = await profilesRepository.remove(user.id, req.params.id);
    await dropProfileCache(removed.id).catch(() => undefined);

    const items = await profilesRepository.listByUser(user.id);
    const active = await profilesRepository.findActiveScope(user.id);
    return { removedId: removed.id, activeProfileId: active?.id ?? null, items };
  });
}
