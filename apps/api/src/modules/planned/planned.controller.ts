import type { FastifyInstance } from 'fastify';
import {
  MAX_PLANNED,
  PLANNED_WINDOW_DAYS,
  createPlannedSchema,
  settlePlannedSchema,
  updatePlannedSchema,
} from '@budget/shared';
import { pool } from '../../config/db.js';
import { authenticate } from '../../shared/auth.js';
import { requireProfile } from '../../shared/current-profile.js';
import { parseOrThrow } from '../../shared/validate.js';
import { ConflictError } from '../../shared/errors.js';
import { plannedRepository } from './planned.repository.js';
import { plannedService } from './planned.service.js';

/** Календарь обязательных трат: правила, экземпляры и решения по ним. */
export async function plannedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Правила и развёрнутые на окно экземпляры — то, чем карусель рисует маркеры. */
  app.get<{ Querystring: { days?: string } }>('/planned', async (req) => {
    const profile = requireProfile(req);
    const days = Math.min(Math.max(Number(req.query.days ?? PLANNED_WINDOW_DAYS), 1), 90);
    const [rules, occurrences] = await Promise.all([
      plannedRepository.listByProfile(profile.id, false),
      plannedService.occurrences(profile, undefined, days),
    ]);
    return { rules, occurrences };
  });

  /** Свободный остаток: баланс за вычетом обязательств до конца периода. */
  app.get('/planned/summary', async (req) => plannedService.summary(requireProfile(req)));

  app.post('/planned', async (req, reply) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(createPlannedSchema, req.body);

    const existing = await plannedRepository.listByProfile(profile.id, false);
    if (existing.length >= MAX_PLANNED) {
      throw new ConflictError(`Больше ${MAX_PLANNED} событий календаря не поддерживается`);
    }

    const created = await plannedRepository.create(profile.id, {
      name: input.name,
      amount: input.amount,
      categoryId: input.categoryId ?? null,
      walletId: input.walletId ?? null,
      recurrence: input.recurrence,
      dueDate: input.dueDate ?? null,
      dueDay: input.dueDay ?? null,
    });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/planned/:id', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(updatePlannedSchema, req.body);
    return plannedRepository.update(profile.id, req.params.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.walletId !== undefined ? { walletId: input.walletId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
  });

  app.delete<{ Params: { id: string } }>('/planned/:id', async (req) => {
    const profile = requireProfile(req);
    await plannedRepository.remove(profile.id, req.params.id);
    return { removedId: req.params.id };
  });

  /** Подтвердить списание — событие превращается в настоящую трату. */
  app.post<{ Params: { id: string } }>('/planned/:id/confirm', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(settlePlannedSchema, req.body);
    return plannedService.confirm(profile, req.params.id, input.dueDate);
  });

  /** Пропустить: денег не трогаем, но из обязательств списание уходит. */
  app.post<{ Params: { id: string } }>('/planned/:id/skip', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(settlePlannedSchema, req.body);
    return plannedService.skip(profile, req.params.id, input.dueDate);
  });

  /** Вернуть событие в ожидающие — если подтвердили или пропустили по ошибке. */
  app.delete<{ Params: { id: string }; Querystring: { dueDate?: string } }>(
    '/planned/:id/settlement',
    async (req) => {
      const profile = requireProfile(req);
      const input = parseOrThrow(settlePlannedSchema, { dueDate: req.query.dueDate });
      await plannedRepository.findOwned(pool, profile.id, req.params.id);
      await plannedRepository.unsettle(req.params.id, input.dueDate);
      return { plannedId: req.params.id, dueDate: input.dueDate, status: 'pending' };
    },
  );
}
