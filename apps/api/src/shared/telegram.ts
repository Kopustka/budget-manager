import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

/**
 * Валидация Telegram WebApp initData.
 * Алгоритм (docs: Telegram Mini Apps → Validating data received via the Mini App):
 *   secret_key = HMAC_SHA256(bot_token, "WebAppData")
 *   check_hash = HMAC_SHA256(data_check_string, secret_key)
 * data_check_string — пары "key=value", отсортированные по ключу, кроме hash, склеенные \n.
 */

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
  raw: URLSearchParams;
}

/** Максимальный возраст initData (защита от replay), сек. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(
  initData: string,
  now: number = Math.floor(Date.now() / 1000),
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new UnauthorizedError('initData: отсутствует hash');

  // data_check_string
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedError('initData: неверная подпись');
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || now - authDate > MAX_AGE_SECONDS) {
    throw new UnauthorizedError('initData: устарел');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new UnauthorizedError('initData: отсутствует user');
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new UnauthorizedError('initData: не удалось разобрать user');
  }
  if (typeof user.id !== 'number') {
    throw new UnauthorizedError('initData: некорректный user.id');
  }

  return { user, authDate, raw: params };
}
