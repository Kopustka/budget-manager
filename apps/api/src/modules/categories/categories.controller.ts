import type { FastifyInstance } from 'fastify';
import {
  MAX_CATEGORIES_PER_KIND,
  createCategorySchema,
  limitStatus,
  nextCategoryColor,
  setLimitSchema,
  updateCategorySchema,
  type Category,
  type LimitStatus,
} from '@budget/shared';
import { pool } from '../../config/db.js';
import { authenticate } from '../../shared/auth.js';
import { requireProfile } from '../../shared/current-profile.js';
import { parseOrThrow } from '../../shared/validate.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { cache } from '../../redis/cache.js';
import { periodOf } from '../../shared/period.js';
import { categoriesRepository } from './categories.repository.js';
import { transactionsRepository } from '../transactions/transactions.repository.js';

/** Категория с прогрессом по плану — форма, которую рисует матрица. */
interface CategoryWithStats extends Category {
  spent: number | null;
  limit: number | null;
  /** SAFE / WARNING / EXCEEDED / NONE. Пороги общие с фронтом (@budget/shared). */
  status: LimitStatus;
  /** Строгий перерасход. Оставлен отдельно от status: аналитика считает по нему. */
  isOverdraft: boolean;
}

/**
 * Собрать статистику по категории расхода. Источник истины — PostgreSQL,
 * посчитанные значения попутно прогревают Redis: проверка лимита при списании
 * читает их оттуда.
 */
async function withStats(
  profileId: string,
  monthStartDay: number,
  period: string,
  category: Category,
): Promise<CategoryWithStats> {
  // У источника дохода плана расходов не бывает — статистику не считаем.
  if (category.kind !== 'expense') {
    return { ...category, spent: null, limit: null, status: 'NONE', isOverdraft: false };
  }

  const [spent, limit] = await Promise.all([
    transactionsRepository.sumSpent(pool, profileId, category.id, period, monthStartDay),
    categoriesRepository.findLimit(pool, category.id, period),
  ]);

  cache.setSpent(profileId, period, category.id, spent);
  // Снятый план обязан исчезнуть и из кэша, иначе проверка лимита продолжит
  // сравнивать траты с суммой, которой в базе уже нет.
  if (limit !== null) cache.setLimit(profileId, period, category.id, limit);
  else cache.clearLimit(profileId, period, category.id);

  return {
    ...category,
    spent,
    limit,
    status: limitStatus(spent, limit),
    isOverdraft: limit !== null && spent > limit,
  };
}

/** Записать план на период в PostgreSQL и в быстрый слой. null — снять план. */
async function persistLimit(
  profileId: string,
  categoryId: string,
  period: string,
  limitAmount: number | null,
): Promise<void> {
  if (limitAmount === null) {
    await categoriesRepository.removeLimit(categoryId, period);
    cache.clearLimit(profileId, period, categoryId);
    return;
  }
  await categoriesRepository.setLimit(categoryId, period, limitAmount);
  cache.setLimit(profileId, period, categoryId, limitAmount);
}

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Категории с текущими spent/limit — то, что рисует матрица. */
  app.get<{ Querystring: { kind?: 'income' | 'expense'; period?: string } }>(
    '/categories',
    async (req) => {
      const profile = requireProfile(req);
      const period = req.query.period ?? periodOf(new Date(), profile.monthStartDay);
      const categories = await categoriesRepository.listByProfile(profile.id, req.query.kind);

      const items = await Promise.all(
        categories.map((c) => withStats(profile.id, profile.monthStartDay, period, c)),
      );
      return { period, items };
    },
  );

  /** Новая категория расхода или источник дохода — сразу с планом на месяц. */
  app.post('/categories', async (req, reply) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(createCategorySchema, req.body);
    const period = periodOf(new Date(), profile.monthStartDay);

    const existing = await categoriesRepository.listByProfile(profile.id, input.kind);
    if (existing.length >= MAX_CATEGORIES_PER_KIND) {
      throw new ConflictError(
        `Больше ${MAX_CATEGORIES_PER_KIND} ${input.kind === 'expense' ? 'категорий' : 'источников'} не поддерживается`,
      );
    }

    const category = await categoriesRepository.create(profile.id, {
      name: input.name,
      kind: input.kind,
      icon: input.icon ?? null,
      // Цвет по умолчанию — первый свободный слот палитры: две категории одного
      // цвета сделали бы легенду доната неоднозначной.
      color: input.color ?? nextCategoryColor(existing.map((c) => c.color)),
    });

    // План осмыслен только для расходов: у источника дохода лимита не бывает.
    const limit = category.kind === 'expense' ? input.limitAmount ?? null : null;
    if (limit !== null) await persistLimit(profile.id, category.id, period, limit);

    // Новой категории статистика известна без запросов: трат по ней ещё нет.
    const isExpense = category.kind === 'expense';
    return reply.code(201).send({
      ...category,
      spent: isExpense ? 0 : null,
      limit,
      status: isExpense ? limitStatus(0, limit) : 'NONE',
      isOverdraft: false,
    } satisfies CategoryWithStats);
  });

  /** Правка категории: оформление и запланированный бюджет на период. */
  app.patch<{ Params: { id: string } }>('/categories/:id', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(updateCategorySchema, req.body);
    const category = await categoriesRepository.findOwned(pool, profile.id, req.params.id);
    const period = input.period ?? periodOf(new Date(), profile.monthStartDay);

    if (input.limitAmount !== undefined && category.kind !== 'expense') {
      throw new ValidationError('Лимит задаётся только категориям расхода');
    }

    const touchesLooks =
      input.name !== undefined || input.icon !== undefined || input.color !== undefined;
    const updated = touchesLooks
      ? await categoriesRepository.update(profile.id, category.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        })
      : category;

    // undefined — поле не пришло, план не трогаем; null — пользователь его снял.
    if (input.limitAmount !== undefined) {
      await persistLimit(profile.id, category.id, period, input.limitAmount);
    }

    return withStats(profile.id, profile.monthStartDay, period, updated);
  });

  /** Установка/обновление лимита категории на период. */
  app.put<{ Params: { id: string } }>('/categories/:id/limit', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(setLimitSchema, req.body);
    const category = await categoriesRepository.findOwned(pool, profile.id, req.params.id);
    if (category.kind !== 'expense') {
      throw new ValidationError('Лимит задаётся только категориям расхода');
    }
    await persistLimit(profile.id, category.id, input.period, input.limitAmount);
    return { categoryId: category.id, period: input.period, limitAmount: input.limitAmount };
  });
}
