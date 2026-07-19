import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Сквозной прогон Фазы 4 в headless-браузере: матрица DnD, запрет жеста,
 * правка и удаление операции, быстрое добавление.
 *
 * Требует: поднятые API и web (`npm run dev:api`, `npm run dev --workspace apps/web`)
 * и свежий `apps/web/.env.local` (`npm run dev-init-data --workspace apps/api`).
 * Запуск: npm run e2e --workspace apps/web
 */
const initData = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8')
  .trim()
  .replace(/^VITE_DEV_INIT_DATA=/, '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

// Официальный telegram-web-app.js перезаписал бы наш стенд-стаб window.Telegram,
// поэтому в тесте его не грузим: эмулируем среду Mini App полностью сами.
await page.route('**/telegram-web-app.js*', (route) => route.abort());

await page.addInitScript((init) => {
  window.Telegram = {
    WebApp: {
      initData: init,
      version: '7.0',
      colorScheme: 'dark',
      safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
      ready() {}, expand() {}, disableVerticalSwipes() {},
      setHeaderColor() {}, setBackgroundColor() {}, onEvent() {},
      HapticFeedback: {
        impactOccurred(s) { (window.__haptics ??= []).push(`impact:${s}`) },
        notificationOccurred(t) { (window.__haptics ??= []).push(`notify:${t}`) },
        selectionChanged() { (window.__haptics ??= []).push('selection') },
      },
    },
  };
}, initData);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}`, ok ? '' : JSON.stringify(detail ?? ''));
};

async function drag(from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Мелкими шагами: dnd-kit активирует жест после 8px и обновляет цель по move
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12,
      a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 12,
    );
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

const balance = async () =>
  (await page.locator('header .tabular').first().innerText()).replace(/\s|₽/g, '');

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

console.log('\n[1] Загрузка экрана');
check('баланс отрисован', /\d/.test(await balance()));
check('карусель времени на месте', (await page.getByRole('button', { name: /расход|^\d+ / }).count()) > 0);

console.log('\n[2] Запрещённый жест: Доход → Расход');
const income = page.locator('[aria-label^="Доход:"]').first();
const categoryCard = page.getByRole('button', { name: /^Категория / }).first();
await drag(income, categoryCard);
const forbiddenToast = page.getByRole('status').first();
check(
  'показано объяснение запрета',
  (await forbiddenToast.innerText()).includes('Нельзя тратить доход'),
  await forbiddenToast.innerText().catch(() => 'нет тоста'),
);
check(
  'шторка ввода суммы НЕ открылась',
  (await page.getByRole('dialog').count()) === 0,
);
check(
  'сработал haptic error',
  (await page.evaluate(() => window.__haptics ?? [])).includes('notify:error'),
);
await page.screenshot({ path: '/tmp/e2e-1-forbidden.png' });

console.log('\n[3] Зачисление: Доход → Кошелёк');
const balanceBefore = await balance();
const wallet = page.locator('[aria-label^="Кошелёк:"]').first();
await drag(income, wallet);
const sheet = page.getByRole('dialog');
check('открылась шторка зачисления', (await sheet.count()) === 1);
await page.screenshot({ path: '/tmp/e2e-2-deposit-sheet.png' });
await sheet.getByRole('button', { name: '1 000 ₽' }).click();
await sheet.getByRole('button', { name: 'Зачислить' }).click();
await page.waitForTimeout(900);
const balanceAfterDeposit = await balance();
check('баланс вырос на 1000', Number(balanceAfterDeposit) === Number(balanceBefore) + 1000, {
  before: balanceBefore,
  after: balanceAfterDeposit,
});
check('операция появилась в ленте дня', (await page.getByRole('button', { name: /Операция зачисление/ }).count()) > 0);

console.log('\n[4] Списание: Кошелёк → Категория');
await drag(wallet, categoryCard);
const spendSheet = page.getByRole('dialog');
check('открылась шторка списания', (await spendSheet.count()) === 1);
await spendSheet.getByRole('textbox').first().fill('500');
await page.screenshot({ path: '/tmp/e2e-3-spend-sheet.png' });
await spendSheet.getByRole('button', { name: 'Списать' }).click();
await page.waitForTimeout(900);
const balanceAfterSpend = await balance();
check('баланс уменьшился на 500', Number(balanceAfterSpend) === Number(balanceAfterDeposit) - 500, {
  before: balanceAfterDeposit,
  after: balanceAfterSpend,
});

console.log('\n[5] Правка операции');
const txCard = page.getByRole('button', { name: /Операция списание/ }).first();
await txCard.click();
await page.waitForTimeout(400);
const editSheet = page.getByRole('dialog');
check('открылась шторка правки', (await editSheet.count()) === 1);
await editSheet.getByRole('textbox').first().fill('200');
await page.screenshot({ path: '/tmp/e2e-4-edit-sheet.png' });
await editSheet.getByRole('button', { name: 'Сохранить' }).click();
await page.waitForTimeout(900);
const balanceAfterEdit = await balance();
check('баланс скорректирован на +300', Number(balanceAfterEdit) === Number(balanceAfterSpend) + 300, {
  before: balanceAfterSpend,
  after: balanceAfterEdit,
});

console.log('\n[6] Удаление операции (двойное подтверждение)');
await page.getByRole('button', { name: /Операция списание/ }).first().click();
await page.waitForTimeout(400);
const delSheet = page.getByRole('dialog');
await delSheet.getByRole('button', { name: 'Удалить операцию' }).click();
await page.waitForTimeout(200);
check('первый тап только запрашивает подтверждение', (await delSheet.getByRole('button', { name: 'Подтвердить удаление' }).count()) === 1);
await delSheet.getByRole('button', { name: 'Подтвердить удаление' }).click();
await page.waitForTimeout(1200);
const balanceAfterDelete = await balance();
check('деньги вернулись (+200)', Number(balanceAfterDelete) === Number(balanceAfterEdit) + 200, {
  before: balanceAfterEdit,
  after: balanceAfterDelete,
});

console.log('\n[7] Быстрое добавление за прошлый день');
await page.getByRole('button', { name: 'Добавить операцию за выбранный день' }).click();
await page.waitForTimeout(400);
check('открылась шторка выбора категории', (await page.getByRole('dialog').count()) === 1);
await page.screenshot({ path: '/tmp/e2e-5-quickadd.png' });
await page.getByRole('dialog').getByRole('button', { name: 'Кафе' }).click();
await page.waitForTimeout(400);
const quickSheet = page.getByRole('dialog');
await quickSheet.getByRole('button', { name: '100 ₽' }).click();
await quickSheet.getByRole('button', { name: 'Списать' }).click();
await page.waitForTimeout(900);
check('операция создана', Number(await balance()) === Number(balanceAfterDelete) - 100, {
  before: balanceAfterDelete,
  after: await balance(),
});

await page.screenshot({ path: '/tmp/e2e-6-final.png', fullPage: true });

// ERR_FAILED — это наш же заблокированный запрос к telegram.org, он ожидаем.
const unexpected = errors.filter((e) => !e.includes('net::ERR_FAILED'));
console.log('\nconsole errors:', unexpected.length ? unexpected : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n🎉 Все проверки пройдены' : `\n💥 Провалено: ${failed}`);
await browser.close();
process.exit(failed === 0 && unexpected.length === 0 ? 0 : 1);
