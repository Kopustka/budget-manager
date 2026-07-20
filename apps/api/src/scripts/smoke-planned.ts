import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { rkey } from '../redis/keys.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { profilesRepository } from '../modules/profiles/profiles.repository.js';
import { plannedRepository } from '../modules/planned/planned.repository.js';
import { plannedService } from '../modules/planned/planned.service.js';
import { analyticsService } from '../modules/analytics/analytics.service.js';
import { alertsService } from '../modules/alerts/alerts.service.js';
import { alertsQueue } from '../modules/alerts/alerts.queue.js';
import { periodOf } from '../shared/period.js';
import { ConflictError } from '../shared/errors.js';

/**
 * Календарь обязательных трат: разворачивание расписания, свободный остаток,
 * подтверждение и пропуск, влияние на прогноз, предупреждения бота.
 *
 * Запуск: npm run smoke:planned --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_555;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function midnight(offsetDays = 0): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offsetDays));
}

async function main(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });
  const profile = await profilesRepository.findActiveScope(user.id);
  if (!profile) throw new Error('У тестового пользователя нет активного профиля');
  const period = periodOf(new Date(), profile.monthStartDay);

  // Чистый лист.
  await pool.query('DELETE FROM transactions WHERE profile_id = $1', [profile.id]);
  await pool.query('DELETE FROM planned_transactions WHERE profile_id = $1', [profile.id]);
  await pool.query('UPDATE wallets SET balance = 100000000 WHERE profile_id = $1', [profile.id]);
  const stale = await redis.keys(`finapp-smoke:profile:${profile.id}:*`);
  if (stale.length > 0) await redis.del(...stale);
  await redis.del(rkey.botAlertsQueue);

  const { rows: cats } = await pool.query<{ id: string }>(
    `SELECT id FROM categories WHERE profile_id = $1 AND kind = 'expense' ORDER BY created_at LIMIT 1`,
    [profile.id],
  );
  const categoryId = cats[0]!.id;

  console.log('\n[1] Ежемесячное правило разворачивается на окно, а не хранится строками');
  const monthly = await plannedRepository.create(profile.id, {
    name: 'Аренда',
    amount: 5_000_000,
    categoryId,
    walletId: null,
    recurrence: 'monthly',
    dueDay: 5,
    dueDate: null,
  });
  const wide = await plannedService.occurrences(profile, midnight(0), 90);
  const rentDates = wide.filter((o) => o.plannedId === monthly.id).map((o) => o.dueDate);
  check('за 90 дней три списания', rentDates.length === 3, rentDates);
  check(
    'все приходятся на 5-е число',
    rentDates.every((d) => d.endsWith('-05')),
    rentDates,
  );
  const { rows: stored } = await pool.query<{ n: string }>(
    'SELECT count(*) n FROM planned_transactions WHERE profile_id = $1',
    [profile.id],
  );
  check('в базе по-прежнему одно правило', Number(stored[0]!.n) === 1, stored[0]?.n);

  console.log('\n[2] Свободный остаток = баланс − неоплаченные обязательства');
  const soon = dayKey(midnight(2));
  const once = await plannedRepository.create(profile.id, {
    name: 'Страховка',
    amount: 300_000,
    categoryId,
    walletId: null,
    recurrence: 'once',
    dueDate: soon,
    dueDay: null,
  });
  const before = await plannedService.summary(profile);
  check('обязательства учтены', before.upcoming > 0, before.upcoming);
  check('свободно = баланс − обязательства', before.free === before.balance - before.upcoming, before);

  console.log('\n[3] Подтверждение превращает событие в настоящую трату');
  const balanceBefore = before.balance;
  const paid = await plannedService.confirm(profile, once.id, soon);
  check('статус оплачено', paid.status === 'paid', paid.status);
  check('появилась операция', Boolean(paid.transactionId), paid);
  const after = await plannedService.summary(profile);
  check('баланс уменьшился на сумму события', after.balance === balanceBefore - 300_000, {
    was: balanceBefore,
    now: after.balance,
  });
  check(
    'оплаченное больше не висит в обязательствах',
    after.upcoming === before.upcoming - 300_000,
    { before: before.upcoming, after: after.upcoming },
  );

  console.log('\n[4] Повторное подтверждение не списывает деньги дважды');
  let rejected = false;
  try {
    await plannedService.confirm(profile, once.id, soon);
  } catch (err) {
    rejected = err instanceof ConflictError;
  }
  const afterRetry = await plannedService.summary(profile);
  check('вторая попытка отклонена', rejected);
  check('баланс не изменился', afterRetry.balance === after.balance, afterRetry.balance);

  console.log('\n[5] Пропуск снимает обязательство, не трогая деньги');
  const rentDate = rentDates.find((d) => d >= dayKey(midnight(0)))!;
  const skipped = await plannedService.skip(profile, monthly.id, rentDate);
  check('статус пропущено', skipped.status === 'skipped', skipped.status);
  const afterSkip = await plannedService.summary(profile);
  check('баланс не тронут', afterSkip.balance === after.balance, afterSkip.balance);

  console.log('\n[6] Прогноз вычитает обязательства из остатка');
  await pool.query('DELETE FROM planned_settlements WHERE planned_id = $1', [monthly.id]);
  await pool.query(
    `INSERT INTO category_limits (category_id, period, limit_amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, period) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`,
    [categoryId, period, 50_000_000],
  );
  const forecast = await analyticsService.forecast(profile, period);
  const upcoming = await plannedService.upcomingTotal(profile, period);
  check('обязательства попали в прогноз', forecast.upcoming === upcoming, {
    forecast: forecast.upcoming,
    upcoming,
  });
  check(
    'остаток уменьшен на обязательства',
    forecast.remaining === (forecast.budget ?? 0) - forecast.spent - forecast.upcoming,
    forecast,
  );

  console.log('\n[7] Бот предупреждает о завтрашнем списании');
  const tomorrow = dayKey(midnight(1));
  await plannedRepository.create(profile.id, {
    name: 'VPN',
    amount: 45_000,
    categoryId,
    walletId: null,
    recurrence: 'once',
    dueDate: tomorrow,
    dueDay: null,
  });
  const queued = await alertsService.schedulePlannedDue();
  check('предупреждение поставлено', queued >= 1, queued);
  const payloads = (await redis.lrange(rkey.botAlertsQueue, 0, -1)).map(
    (p) => JSON.parse(p) as { kind: string; name?: string },
  );
  check(
    'в очереди именно про VPN',
    payloads.some((p) => p.kind === 'planned_due' && p.name === 'VPN'),
    payloads.map((p) => p.kind),
  );
  const again = await alertsService.schedulePlannedDue();
  check('повторный прогон не дублирует', again === 0, again);

  console.log('\n[8] Кэш календаря в Redis');
  await plannedService.occurrences(profile);
  const zcard = await redis.zcard(rkey.planned(profile.id));
  check('ближайшие события в ZSET', zcard > 0, zcard);

  await pool.query('DELETE FROM planned_transactions WHERE profile_id = $1', [profile.id]);
  await pool.query('DELETE FROM transactions WHERE profile_id = $1', [profile.id]);
  console.log(
    failures === 0 ? '\n✅ Календарь обязательств: все проверки пройдены' : `\n❌ Провалов: ${failures}`,
  );
  await alertsQueue.size();
  await redis.quit();
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
