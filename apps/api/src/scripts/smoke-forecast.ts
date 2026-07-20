import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { periodOf } from '../shared/period.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { profilesRepository } from '../modules/profiles/profiles.repository.js';
import { analyticsService } from '../modules/analytics/analytics.service.js';
import { alertsService } from '../modules/alerts/alerts.service.js';
import { renderAlert } from '../bot/messages.js';
import type { BotAlert } from '../modules/alerts/alerts.types.js';

/**
 * Прогноз бюджета (burn rate), дни без трат и вечерний отчёт.
 *
 * Данные раскладываем прямо в PostgreSQL с нужными датами: через HTTP задним
 * числом такую картину не собрать, а проверять надо именно арифметику окон.
 *
 * Запуск: npm run smoke:forecast --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_444;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

/** Полночь UTC дня, отстоящего от сегодняшнего на `offset` суток. */
function dayAgo(offset: number): Date {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - offset * 86_400_000);
}

async function main(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });
  const profile = await profilesRepository.findActiveScope(user.id);
  if (!profile) throw new Error('У тестового пользователя нет активного профиля');
  const period = periodOf(new Date(), profile.monthStartDay);

  await pool.query('DELETE FROM transactions WHERE profile_id = $1', [profile.id]);
  await pool.query('UPDATE wallets SET balance = 100000000 WHERE profile_id = $1', [profile.id]);
  const { rows: wallets } = await pool.query<{ id: string }>(
    'SELECT id FROM wallets WHERE profile_id = $1 LIMIT 1',
    [profile.id],
  );
  const { rows: cats } = await pool.query<{ id: string }>(
    `SELECT id FROM categories WHERE profile_id = $1 AND kind = 'expense' ORDER BY created_at`,
    [profile.id],
  );
  const walletId = wallets[0]!.id;
  const categoryId = cats[0]!.id;
  await pool.query('DELETE FROM category_limits WHERE category_id = ANY($1)', [
    cats.map((c) => c.id),
  ]);

  const spend = (amount: number, at: Date) =>
    pool.query(
      `INSERT INTO transactions (profile_id, type, wallet_id, category_id, amount, occurred_at)
       VALUES ($1, 'spend', $2, $3, $4, $5)`,
      [profile.id, walletId, categoryId, amount, at],
    );

  console.log('\n[1] Без лимитов прогноза не существует');
  const noBudget = await analyticsService.forecast(profile, period);
  check('вердикт NO_BUDGET', noBudget.verdict === 'NO_BUDGET', noBudget.verdict);
  check('срок не выдуман', noBudget.daysLeftAtBurn === null, noBudget.daysLeftAtBurn);

  console.log('\n[2] Темп считается по полным дням, сегодняшний не занижает');
  // По 1 000 ₽ в каждый из 7 полных дней + крупная трата сегодня.
  for (let i = 1; i <= 7; i += 1) await spend(100_000, new Date(dayAgo(i).getTime() + 43_200_000));
  await spend(5_000_000, new Date());
  const burn = await analyticsService.forecast(profile, period);
  check('окно — 7 дней', burn.windowDays === 7, burn.windowDays);
  check('темп = 1 000 ₽/день', burn.dailyBurn === 100_000, burn.dailyBurn);

  console.log('\n[3] Вердикты по остатку бюджета');
  // Потрачено 5 700 000. Лимит 6 000 000 → остаток 300 000 = 3 дня при темпе 1 000 ₽.
  await pool.query(
    `INSERT INTO category_limits (category_id, period, limit_amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, period) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`,
    [categoryId, period, 6_000_000],
  );
  const tight = await analyticsService.forecast(profile, period);
  check('остаток посчитан', tight.remaining === 6_000_000 - tight.spent, {
    remaining: tight.remaining,
    spent: tight.spent,
  });
  check('дней при нынешнем темпе', tight.daysLeftAtBurn === 3, tight.daysLeftAtBurn);
  check(
    'вердикт SHORTFALL, если в периоде осталось больше',
    tight.daysLeftInPeriod > 3 ? tight.verdict === 'SHORTFALL' : tight.verdict !== 'SHORTFALL',
    { verdict: tight.verdict, daysLeftInPeriod: tight.daysLeftInPeriod },
  );

  // Щедрый лимит — хватит с запасом.
  await pool.query('UPDATE category_limits SET limit_amount = $2 WHERE category_id = $1', [
    categoryId,
    900_000_00,
  ]);
  const ok = await analyticsService.forecast(profile, period);
  check('вердикт ON_TRACK при большом бюджете', ok.verdict === 'ON_TRACK', ok.verdict);

  console.log('\n[4] Дни без трат');
  const noSpend = await analyticsService.noSpendDays(profile, period);
  // Траты были в каждый из последних 7 дней и сегодня — чистых дней среди них нет.
  const recent = [0, 1, 2, 3].map((i) => dayAgo(i).toISOString().slice(0, 10));
  check(
    'дни с тратами не отмечены',
    recent.every((d) => !noSpend.days.includes(d)),
    noSpend.days,
  );
  check('серия прервана', noSpend.currentStreak === 0, noSpend.currentStreak);

  // Убираем траты последних двух дней — появляется живая серия.
  await pool.query(
    `DELETE FROM transactions WHERE profile_id = $1 AND occurred_at >= $2`,
    [profile.id, dayAgo(1)],
  );
  const streak = await analyticsService.noSpendDays(profile, period);
  check('серия = 2 (вчера и сегодня)', streak.currentStreak === 2, streak.currentStreak);
  check('лучшая серия не меньше текущей', streak.bestStreak >= streak.currentStreak, streak);
  check('всего дней без трат совпадает со списком', streak.total === streak.days.length, streak);

  console.log('\n[5] Вечерний отчёт: цифры подставляются при доставке');
  const dayKey = new Date().toISOString().slice(0, 10);
  const stub: BotAlert = {
    kind: 'daily_digest',
    profileId: profile.id,
    telegramId: profile.telegramId,
    currency: profile.currency,
    queuedAt: new Date().toISOString(),
    day: dayKey,
  };
  const clean = await alertsService.hydrateAlert(stub);
  check(
    'без трат за день — отчёт про серию',
    clean.kind === 'daily_digest' && clean.spentToday === 0 && (clean.noSpendStreak ?? 0) >= 1,
    clean,
  );
  console.log(`\n${renderAlert(clean)}\n`);

  await spend(120_000, new Date());
  const spent = await alertsService.hydrateAlert(stub);
  check(
    'с тратами — суммы за день и остаток',
    spent.kind === 'daily_digest' && spent.spentToday === 120_000 && spent.remaining !== null,
    spent,
  );
  console.log(`\n${renderAlert(spent)}\n`);

  await pool.query('DELETE FROM transactions WHERE profile_id = $1', [profile.id]);
  console.log(
    failures === 0 ? '✅ Прогноз и дни без трат: все проверки пройдены' : `❌ Провалов: ${failures}`,
  );
  await redis.quit();
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
