import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Печатает подписанный Telegram initData для тестового пользователя.
 * Нужен, чтобы гонять фронт в обычном браузере, не ослабляя проверку подписи на API.
 *
 *   npm run dev-init-data --workspace apps/api >> apps/web/.env.local
 *
 * Срок жизни — 24 часа (MAX_AGE_SECONDS в shared/telegram.ts), потом перевыпустить.
 */
const TEST_TELEGRAM_ID = 111_111_111;

const params = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'dev',
  user: JSON.stringify({
    id: TEST_TELEGRAM_ID,
    username: 'test_user',
    first_name: 'Тест',
  }),
});

const dataCheckString = [...params.entries()]
  .map(([k, v]) => `${k}=${v}`)
  .sort()
  .join('\n');

const secret = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));

// eslint-disable-next-line no-console
console.log(`VITE_DEV_INIT_DATA=${params.toString()}`);
