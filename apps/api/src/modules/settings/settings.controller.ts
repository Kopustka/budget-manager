import type { FastifyInstance } from 'fastify';
import { changeCurrencySchema, updateSettingsSchema } from '@budget/shared';
import { authenticate } from '../../shared/auth.js';
import { requireProfile } from '../../shared/current-profile.js';
import { parseOrThrow } from '../../shared/validate.js';
import { settingsService } from './settings.service.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/settings', async (req) => settingsService.describe(requireProfile(req)));

  /** День начала расчётного месяца. */
  app.patch('/settings', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(updateSettingsSchema, req.body);
    return settingsService.setMonthStartDay(profile, input.monthStartDay);
  });

  /** Смена валюты с пересчётом сумм — необратимая операция. */
  app.post('/settings/currency', async (req) => {
    const profile = requireProfile(req);
    const input = parseOrThrow(changeCurrencySchema, req.body);
    return settingsService.changeCurrency(profile, input);
  });
}
