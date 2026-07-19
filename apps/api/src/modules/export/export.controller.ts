import type { FastifyInstance } from 'fastify';
import { InputFile } from 'grammy';
import { exportRequestSchema } from '@budget/shared';
import { authenticate } from '../../shared/auth.js';
import { requireUser } from '../../shared/current-user.js';
import { parseOrThrow } from '../../shared/validate.js';
import { AppError } from '../../shared/errors.js';
import { getBotApi } from '../../bot/bot-api.js';
import { exportService } from './export.service.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /**
   * Выгрузка операций файлом в чат бота.
   * В Telegram WebView скачивание часто блокируется, поэтому файл доставляем
   * тем каналом, который в Telegram работает всегда.
   */
  app.post('/export', async (req) => {
    const user = requireUser(req);
    const input = parseOrThrow(exportRequestSchema, req.body ?? {});

    const { csv, rows, fileName } = await exportService.build(user, input.from, input.to);
    if (rows === 0) {
      throw new AppError(422, 'За выбранный период операций нет', 'EMPTY_EXPORT');
    }

    const caption = input.from || input.to ? 'Выгрузка за выбранный период' : 'Полная выгрузка операций';

    try {
      await getBotApi().sendDocument(user.telegramId, new InputFile(csv, fileName), {
        caption: `${caption}: ${rows} операц${rows % 10 === 1 && rows % 100 !== 11 ? 'ия' : 'ий'}`,
      });
    } catch (err) {
      // Чат появляется только после /start — это самая частая причина отказа,
      // и пользователю нужно сказать именно её, а не «ошибка Telegram».
      const description = String((err as { description?: string } | null)?.description ?? '');
      if (/chat not found|bot was blocked/i.test(description)) {
        throw new AppError(
          409,
          'Бот не может написать вам первым. Откройте чат с ботом, нажмите «Старт» и повторите выгрузку.',
          'BOT_CHAT_UNAVAILABLE',
        );
      }
      throw err;
    }

    return { sent: true, rows, fileName };
  });
}
