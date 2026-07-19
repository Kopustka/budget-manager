import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * .env ищем от расположения самого модуля, а не от cwd: иначе конфиг
 * находится только при запуске из apps/api и молча теряется под systemd.
 * Путь общий для dev (src/config) и прода (dist/config) — оба на два уровня
 * ниже корня пакета.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: resolve(packageRoot, '.env') });

/**
 * Валидация переменных окружения на старте. Падаем сразу, если конфиг неполный,
 * чтобы не ловить ошибки в рантайме.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  REDIS_URL: z.string().min(1, 'REDIS_URL обязателен'),
  /**
   * Префикс всех ключей Redis. Позволяет держать прод и проверки на одном
   * сервере: иначе запущенный воркер разбирает очередь у смоук-теста.
   */
  REDIS_NAMESPACE: z.string().min(1).default('finapp'),

  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN обязателен'),
  TELEGRAM_BOT_USERNAME: z.string().default('bugetmanagementbot'),

  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Некорректный .env:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
