import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { profilesRepository } from '../modules/profiles/profiles.repository.js';
import { categoriesRepository } from '../modules/categories/categories.repository.js';
import { walletsRepository } from '../modules/wallets/wallets.repository.js';
import { transactionsService } from '../modules/transactions/transactions.service.js';
import { ConflictError } from '../shared/errors.js';

/**
 * Проверка профилей: изоляция данных, переключение и удаление.
 *
 * Главное здесь — что профили не видят друг друга: одинаковые имена категорий
 * разрешены, а операции одного не попадают в другой.
 *
 * Запуск: npm run smoke:profiles --workspace apps/api
 */
const TEST_TELEGRAM_ID = 111_111_333;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? '');
  }
}

async function main(): Promise<void> {
  const user = await usersRepository.upsertByTelegram({ telegramId: TEST_TELEGRAM_ID });

  // Чистый лист: оставляем ровно один профиль, остальные с прошлых прогонов сносим.
  const before = await profilesRepository.listByUser(user.id);
  const keep = before[0]!;
  await pool.query('UPDATE users SET active_profile_id = $2 WHERE id = $1', [user.id, keep.id]);
  for (const p of before.slice(1)) {
    await pool.query('DELETE FROM profiles WHERE id = $1', [p.id]);
  }

  console.log('\n[1] Стартовый профиль создан вместе с пользователем');
  const active = (await profilesRepository.findActiveScope(user.id))!;
  check('активный профиль есть', Boolean(active), active?.id);
  check('в нём есть кошелёк', (await walletsRepository.listByProfile(active.id)).length > 0);
  check(
    'и категории',
    (await categoriesRepository.listByProfile(active.id)).length > 0,
  );
  check('адрес для пушей известен', active.telegramId === TEST_TELEGRAM_ID, active.telegramId);

  console.log('\n[2] Второй профиль — со своей валютой и своим набором');
  const second = await profilesRepository.create(user.id, {
    name: 'Бизнес',
    currency: 'USD',
    monthStartDay: 10,
  });
  check('валюта своя', second.currency === 'USD', second.currency);
  check('день месяца свой', second.monthStartDay === 10, second.monthStartDay);
  const secondWallets = await walletsRepository.listByProfile(second.id);
  check('стартовый кошелёк заведён', secondWallets.length === 1, secondWallets.length);
  check(
    'кошелёк в валюте профиля',
    secondWallets[0]?.currency === 'USD',
    secondWallets[0]?.currency,
  );

  console.log('\n[3] Изоляция: одинаковые имена категорий в разных профилях');
  const firstCats = await categoriesRepository.listByProfile(active.id);
  const secondCats = await categoriesRepository.listByProfile(second.id);
  const sameNames = firstCats
    .map((c) => c.name)
    .filter((n) => secondCats.some((c) => c.name === n));
  check('одноимённые категории сосуществуют', sameNames.length > 0, sameNames);
  check(
    'наборы не пересекаются по id',
    firstCats.every((c) => !secondCats.some((s) => s.id === c.id)),
  );

  let duplicateRejected = false;
  try {
    await categoriesRepository.create(second.id, {
      name: secondCats[0]!.name,
      kind: secondCats[0]!.kind,
      icon: null,
      color: null,
    });
  } catch {
    duplicateRejected = true;
  }
  check('но внутри одного профиля дубликат отклонён', duplicateRejected);

  console.log('\n[4] Операция видна только в своём профиле');
  const scope = { ...second, telegramId: active.telegramId };
  const wallet = secondWallets[0]!;
  await pool.query('UPDATE wallets SET balance = 1000000 WHERE id = $1', [wallet.id]);
  const expense = secondCats.find((c) => c.kind === 'expense')!;
  await transactionsService.processDnd(
    { ...scope, currency: 'USD' },
    {
      source: 'wallet',
      target: 'expense',
      walletId: wallet.id,
      categoryId: expense.id,
      amount: 25000,
    },
  );
  const { rows: counts } = await pool.query<{ profile_id: string; n: string }>(
    'SELECT profile_id, count(*) n FROM transactions WHERE profile_id = ANY($1) GROUP BY profile_id',
    [[active.id, second.id]],
  );
  const inSecond = Number(counts.find((c) => c.profile_id === second.id)?.n ?? 0);
  const inFirst = Number(counts.find((c) => c.profile_id === active.id)?.n ?? 0);
  check('операция легла во второй профиль', inSecond === 1, inSecond);
  check('в первом её нет', inFirst === 0, inFirst);

  console.log('\n[5] Переключение активного профиля');
  await profilesRepository.setActive(user.id, second.id);
  const nowActive = await profilesRepository.findActiveScope(user.id);
  check('активным стал второй', nowActive?.id === second.id, nowActive?.name);
  check('и валюта сменилась вместе с ним', nowActive?.currency === 'USD', nowActive?.currency);

  console.log('\n[6] Удаление профиля');
  let lastGuard = false;
  await profilesRepository.remove(user.id, second.id);
  const afterRemoval = await profilesRepository.listByUser(user.id);
  check('профиль удалён', afterRemoval.length === 1, afterRemoval.map((p) => p.name));
  const fallback = await profilesRepository.findActiveScope(user.id);
  // Удаляли открытый профиль — активным обязан стать оставшийся, иначе
  // следующий запрос пользователя упёрся бы в 401.
  check('активным стал оставшийся', fallback?.id === keep.id, fallback?.name);

  const { rows: orphans } = await pool.query<{ n: string }>(
    'SELECT count(*) n FROM transactions WHERE profile_id = $1',
    [second.id],
  );
  check('операции удалённого профиля ушли каскадом', Number(orphans[0]!.n) === 0, orphans[0]?.n);

  try {
    await profilesRepository.remove(user.id, keep.id);
  } catch (err) {
    lastGuard = err instanceof ConflictError;
  }
  check('единственный профиль удалить нельзя', lastGuard);

  console.log(
    failures === 0 ? '\n✅ Профили: все проверки пройдены' : `\n❌ Провалов: ${failures}`,
  );
  await redis.quit();
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
