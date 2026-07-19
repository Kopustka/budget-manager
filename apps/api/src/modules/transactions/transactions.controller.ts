import type { FastifyInstance } from 'fastify';
import { dndEventSchema, editTransactionSchema, type TransactionType } from '@budget/shared';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { parseOrThrow } from '../../shared/validate.js';
import { transactionsService } from './transactions.service.js';
import { transactionsRepository } from './transactions.repository.js';

/** Маршруты транзакций и DnD-ядра. Все требуют Telegram-аутентификации. */
export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Событие Drag-and-Drop матрицы: зачисление или списание. */
  app.post('/dnd', async (req, reply) => {
    const user = requireUser(req);
    const input = parseOrThrow(dndEventSchema, req.body);
    const result = await transactionsService.processDnd(user, input);
    reply.status(201).send(result);
  });

  /**
   * История. Три режима, от узкого к широкому:
   *   ?day=YYYY-MM-DD      — один день (карусель на главной);
   *   ?from=&to=&type=&categoryId= — произвольный отрезок с фильтрами (раздел «История»);
   *   ?days=N              — последние N дней (поведение по умолчанию).
   * Вместе с лентой отдаём итоги: считать их на клиенте по обрезанному списку нельзя.
   */
  app.get<{
    Querystring: {
      days?: string;
      day?: string;
      from?: string;
      to?: string;
      type?: TransactionType;
      categoryId?: string;
    };
  }>('/transactions', async (req) => {
    const user = requireUser(req);
    const { day, from, to, type, categoryId } = req.query;

    if (day) {
      return { items: await transactionsRepository.listByDay(user.id, day) };
    }

    if (from || to || type || categoryId) {
      const query = { userId: user.id, from, to, type, categoryId };
      const [items, totals] = await Promise.all([
        transactionsRepository.listRange(query),
        transactionsRepository.totalsRange(query),
      ]);
      return { items, totals };
    }

    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    return { items: await transactionsRepository.listRecent(user.id, days) };
  });

  app.patch<{ Params: { id: string } }>('/transactions/:id', async (req) => {
    const user = requireUser(req);
    const input = parseOrThrow(editTransactionSchema, req.body);
    return transactionsService.edit(user, req.params.id, input);
  });

  app.delete<{ Params: { id: string } }>('/transactions/:id', async (req) => {
    const user = requireUser(req);
    return transactionsService.remove(user, req.params.id);
  });
}
