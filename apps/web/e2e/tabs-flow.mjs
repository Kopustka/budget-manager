import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Сквозной прогон разделов «История» и «Настройки»: четыре вкладки, фильтры и
 * итоги истории, смена дня начала расчётного месяца.
 *
 * Требует: поднятые API и web и свежий `apps/web/.env.local`
 * (`npm run --silent dev-init-data --workspace apps/api > apps/web/.env.local`).
 * Запуск: npm run e2e:tabs --workspace apps/web
 *
 * Выгрузку CSV здесь не дёргаем: она уходит реальным запросом в Telegram,
 * её проверяет `npm run smoke:settings --workspace apps/api` с застабленным ботом.
 */
const initData = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8')
  .trim()
  .replace(/^VITE_DEV_INIT_DATA=/, '');

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

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
        impactOccurred() {}, notificationOccurred() {}, selectionChanged() {},
      },
    },
  };
}, initData);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}`, ok ? '' : JSON.stringify(detail ?? ''));
};

const nav = (label) => page.locator('nav').getByRole('button', { name: label });

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

console.log('\n[1] Четыре раздела в навигации');
for (const label of ['Главная', 'История', 'Аналитика', 'Настройки']) {
  check(`вкладка «${label}» на месте`, (await nav(label).count()) === 1);
}
// Тач-цель: Apple HIG и Material сходятся на 44px — ниже промахи по кнопке заметны.
const navBox = await nav('История').boundingBox();
check('высота вкладки ≥ 44px', navBox.height >= 44, navBox.height);

console.log('\n[2] Главная: превью ленты и переход в историю');
const dayOps = await page.locator('main ul li').count();
check('на главной не больше трёх операций дня', dayOps <= 3, dayOps);
const historyLink = page.locator('main').getByRole('button', { name: /вся история/i });
check('ссылка «Вся история» есть', (await historyLink.count()) === 1);
await historyLink.click();
await page.waitForTimeout(900);
check(
  'ссылка ведёт в раздел «История»',
  (await page.getByRole('heading', { name: 'История операций' }).count()) === 1,
);

console.log('\n[3] История: итоги и период');
const totalsCards = page.locator('main').getByText(/^(Пришло|Ушло)$/);
check('итоги за период показаны', (await totalsCards.count()) === 2);
const rangeLabel = await page.locator('main header p').first().innerText();
check('подписан отрезок, а не просто месяц', /—/.test(rangeLabel), rangeLabel);
check('кнопка «Следующий период» заблокирована на текущем',
  await page.getByRole('button', { name: 'Следующий период' }).isDisabled());
await page.getByRole('button', { name: 'Предыдущий период' }).click();
await page.waitForTimeout(900);
const prevLabel = await page.locator('main header p').first().innerText();
check('переход в прошлый период меняет подпись', prevLabel !== rangeLabel, { rangeLabel, prevLabel });
await page.getByRole('button', { name: 'Следующий период' }).click();
await page.waitForTimeout(900);

console.log('\n[4] История: фильтры');
await page.getByRole('button', { name: 'Фильтры' }).click();
await page.waitForTimeout(250);
check('панель фильтров раскрылась',
  (await page.getByRole('button', { name: 'Доходы' }).count()) === 1);
await page.getByRole('button', { name: 'Доходы' }).click();
await page.waitForTimeout(900);
const depositRows = await page.getByLabel('Операция зачисление, изменить').count();
const spendRows = await page.getByLabel('Операция списание, изменить').count();
check('фильтр «Доходы» оставил только зачисления', spendRows === 0, { depositRows, spendRows });
check('фильтр отражён в подписи кнопки',
  (await page.getByRole('button', { name: /Фильтры/ }).innerText()).includes('доходы'));
await page.getByRole('button', { name: 'Расходы' }).click();
await page.waitForTimeout(900);
check(
  'фильтр «Расходы» оставил только списания',
  (await page.getByLabel('Операция зачисление, изменить').count()) === 0,
);
await page.getByRole('button', { name: 'Все', exact: true }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/e2e-history.png', fullPage: true });

console.log('\n[5] Создание кошелька и категории');
await nav('Главная').click();
await page.waitForTimeout(900);
// Имя со штампом времени: прогон не должен спотыкаться о свои же прошлые запуски.
const stamp = String(await page.evaluate(() => Date.now())).slice(-6);
const walletName = `e2e Кошелёк ${stamp}`;
await page.locator('main').getByRole('button', { name: 'Кошелёк', exact: true }).click();
await page.waitForTimeout(300);
const walletSheet = page.getByRole('dialog');
check('шторка создания кошелька открылась', (await walletSheet.count()) === 1);
await walletSheet.getByPlaceholder('например, Карта').fill(walletName);
await walletSheet.getByLabel('Сумма').fill('300');
await walletSheet.getByRole('button', { name: 'Создать' }).click();
await page.waitForTimeout(1200);
check('кошелёк появился на главной', (await page.getByText(walletName).count()) > 0);
check(
  'стартовый баланс учтён',
  (await page.locator('main').getByText('300 ₽').count()) > 0,
);

const categoryName = `e2e Спорт ${stamp}`;
await page.locator('main').getByRole('button', { name: 'Категория расхода' }).click();
await page.waitForTimeout(300);
const catSheet = page.getByRole('dialog');
await catSheet.getByPlaceholder('например, Спорт').fill(categoryName);
await catSheet.getByRole('button', { name: 'Иконка dumbbell' }).click();
await catSheet.getByRole('button', { name: 'Создать' }).click();
await page.waitForTimeout(1200);
check('категория появилась в матрице', (await page.getByText(categoryName).count()) > 0);

// Дубликат имени должен получить внятный отказ, а не молча создаться вторым.
await page.locator('main').getByRole('button', { name: 'Категория расхода' }).click();
await page.waitForTimeout(300);
const dupSheet = page.getByRole('dialog');
await dupSheet.getByPlaceholder('например, Спорт').fill(categoryName);
await dupSheet.getByRole('button', { name: 'Создать' }).click();
await page.waitForTimeout(1000);
check(
  'дубликат объяснён пользователю',
  (await dupSheet.getByText(/уже есть/).count()) === 1,
  await dupSheet.innerText().catch(() => ''),
);
await dupSheet.getByRole('button', { name: 'Закрыть' }).click();
await page.waitForTimeout(400);

console.log('\n[6] История по категории');
await page.getByRole('button', { name: /^Категория Кафе/ }).click();
await page.waitForTimeout(1200);
const catDetails = page.getByRole('dialog');
check('шторка категории открылась', (await catDetails.count()) === 1);
check(
  'показана история именно этой категории',
  (await catDetails.getByText('Операции по категории').count()) === 1,
);
check(
  'есть переход во всю историю категории',
  (await catDetails.getByRole('button', { name: /вся история/i }).count()) === 1,
);
await catDetails.getByRole('button', { name: /вся история/i }).click();
await page.waitForTimeout(1200);
check(
  'история открылась с фильтром по категории',
  (await page.getByRole('button', { name: /Фильтры/ }).innerText()).includes('Кафе'),
  await page.getByRole('button', { name: /Фильтры/ }).innerText(),
);

console.log('\n[7] Настройки: день начала месяца');
await nav('Настройки').click();
await page.waitForTimeout(900);
check('экран настроек открылся',
  (await page.getByRole('heading', { name: 'Начало месяца' }).count()) === 1);
const dayButton = (n) => page.locator('main').getByRole('button', { name: String(n), exact: true });
check('по умолчанию выбран 1-й день', (await dayButton(1).getAttribute('aria-pressed')) === 'true');
await dayButton(2).click();
await page.waitForTimeout(1200);
check('день начала переключился на 2', (await dayButton(2).getAttribute('aria-pressed')) === 'true');
const periodHint = await page.locator('main').getByText(/Текущий период:/).innerText();
check('подсказка показывает новые границы', /Текущий период: 2 /.test(periodHint), periodHint);
await page.screenshot({ path: '/tmp/e2e-settings.png', fullPage: true });

console.log('\n[8] Сдвинутый период доезжает до других экранов');
await nav('Главная').click();
await page.waitForTimeout(900);
const homeLabel = await page.locator('header p.text-xs').first().innerText();
check('на главной заголовок стал диапазоном', /—/.test(homeLabel), homeLabel);

// Возвращаем 1-е число: тест не должен оставлять после себя изменённые настройки.
await nav('Настройки').click();
await page.waitForTimeout(700);
await dayButton(1).click();
await page.waitForTimeout(1200);
check('день начала возвращён на 1', (await dayButton(1).getAttribute('aria-pressed')) === 'true');

// 409 — наш же тест дубликата имени: ожидаемый ответ, а не сбой страницы.
const unexpected = errors.filter(
  (e) => !e.includes('net::ERR_FAILED') && !e.includes('409 (Conflict)'),
);
console.log('\nconsole errors:', unexpected.length ? unexpected : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n🎉 Все проверки пройдены' : `\n💥 Провалено: ${failed}`);
await browser.close();
process.exit(failed === 0 && unexpected.length === 0 ? 0 : 1);
