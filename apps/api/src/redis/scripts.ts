import { redis } from '../config/redis.js';

/**
 * Lua-скрипты Redis: операции, которые обязаны быть неделимыми.
 *
 * Проверка лимита состоит из четырёх шагов — записать трату, прочитать лимит,
 * сравнить и поставить пуш. Между шагами, разнесёнными по round-trip'ам, влезает
 * параллельная трата: два запроса по одной категории читают одно и то же «ещё не
 * превышено» и оба молчат, либо оба ставят по уведомлению. EVAL выполняется
 * единым блоком, поэтому такого окна нет.
 */

/**
 * ARGV: [1] categoryId, [2] точный spent, [3] лимит-фолбэк ('' — неизвестен),
 *       [4] TTL дедупликатора, [5] payload превышения, [6] payload исчерпания.
 * KEYS: [1] spent-хэш, [2] limits-хэш, [3] дедуп overdraft, [4] дедуп
 *       limit_reached, [5] очередь бота.
 * Возврат: { spent, kind } — kind пуст, если уведомление не ставилось.
 */
const SETTLE_SPEND_LUA = `
local categoryId = ARGV[1]
local spent = tonumber(ARGV[2])

-- Пишем не инкремент, а точное значение, посчитанное SUM'ом в PostgreSQL уже
-- после коммита: источник истины один, и кэш не накапливает ошибку от гонок,
-- повторов запроса и правок задним числом.
redis.call('HSET', KEYS[1], categoryId, spent)

local limitRaw = redis.call('HGET', KEYS[2], categoryId)
if not limitRaw then
  -- Промах кэша лимитов: прогреваем его значением из PostgreSQL, иначе каждая
  -- следующая трата снова ходила бы в базу за тем же числом.
  if ARGV[3] == '' then return { spent, '' } end
  limitRaw = ARGV[3]
  redis.call('HSET', KEYS[2], categoryId, limitRaw)
end

local limit = tonumber(limitRaw)
if limit <= 0 or spent < limit then return { spent, '' } end

-- Ровно исчерпанный лимит и перерасход — разные события с разным текстом.
local kind, dedupeKey, payload
if spent > limit then
  kind, dedupeKey, payload = 'overdraft', KEYS[3], ARGV[5]
else
  kind, dedupeKey, payload = 'limit_reached', KEYS[4], ARGV[6]
end

-- Сравнивали с лимитом из Redis — его же подставляем в текст уведомления.
-- Иначе пуш мог бы назвать сумму плана, отличную от той, по которой сработал.
payload = string.gsub(payload, '"limit":%-1', '"limit":' .. limitRaw)

-- Дедупликатор в том же блоке: иначе достижение лимита слало бы уведомление
-- на каждую следующую трату по категории до конца периода.
if redis.call('SET', dedupeKey, '1', 'EX', ARGV[4], 'NX') then
  redis.call('LPUSH', KEYS[5], payload)
  return { spent, kind }
end

return { spent, '' }
`;

redis.defineCommand('settleSpend', { numberOfKeys: 5, lua: SETTLE_SPEND_LUA });

/** ioredis добавляет метод динамически — описываем его форму для типизации. */
interface ScriptedRedis {
  settleSpend(
    spentKey: string,
    limitsKey: string,
    overdraftKey: string,
    limitReachedKey: string,
    queueKey: string,
    categoryId: string,
    spent: string,
    fallbackLimit: string,
    dedupeTtlSeconds: string,
    overdraftPayload: string,
    limitReachedPayload: string,
  ): Promise<[number, string]>;
}

export const scripts = redis as unknown as typeof redis & ScriptedRedis;
