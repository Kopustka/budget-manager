import { z } from 'zod';
import { CATEGORY_COLORS, CATEGORY_ICONS } from './catalog.js';
import { CURRENCY_CODES, MAX_MONTH_START_DAY, MIN_MONTH_START_DAY } from './currency.js';
import type { TransactionType } from './types.js';

/** Zod-схемы запросов/ответов API. Используются для валидации на бэке и типизации на фронте. */

export const amountSchema = z
  .number()
  .int('Сумма должна быть в минорных единицах (integer)')
  .positive('Сумма должна быть положительной');

/** POST /api/dnd — обработка события Drag-and-Drop матрицы */
export const dndEventSchema = z
  .object({
    source: z.enum(['income', 'wallet', 'expense']),
    target: z.enum(['income', 'wallet', 'expense']),
    /** Для перевода — кошелёк-источник. */
    walletId: z.string().uuid(),
    /** Только для перевода «кошелёк → кошелёк»: куда идут деньги. */
    toWalletId: z.string().uuid().optional(),
    /** Обязательна для зачисления и списания; у перевода категории нет. */
    categoryId: z.string().uuid().optional(),
    amount: amountSchema,
    subcategory: z.string().max(64).nullish(),
    comment: z.string().max(280).nullish(),
    /** ISO-дата события (для добавления задним числом из карусели) */
    occurredAt: z.string().datetime().optional(),
  })
  // Набор полей зависит от жеста, поэтому форму проверяем здесь, а не в сервисе:
  // так «перевод без второго кошелька» не доезжает до транзакции БД.
  .superRefine((v, ctx) => {
    const isTransfer = v.source === 'wallet' && v.target === 'wallet';
    if (isTransfer) {
      if (!v.toWalletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toWalletId'],
          message: 'Для перевода нужен кошелёк-получатель',
        });
      } else if (v.toWalletId === v.walletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toWalletId'],
          message: 'Перевод в тот же кошелёк невозможен',
        });
      }
      return;
    }
    if (!v.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'Не указана категория',
      });
    }
    if (v.toWalletId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toWalletId'],
        message: 'Второй кошелёк допустим только при переводе',
      });
    }
  });
export type DndEventInput = z.infer<typeof dndEventSchema>;

/** PATCH /api/transactions/:id — редактирование транзакции */
export const editTransactionSchema = z.object({
  amount: amountSchema.optional(),
  subcategory: z.string().max(64).nullish(),
  comment: z.string().max(280).nullish(),
  categoryId: z.string().uuid().optional(),
});
export type EditTransactionInput = z.infer<typeof editTransactionSchema>;

/** POST /api/wallets — новый кошелёк */
export const createWalletSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название'),
  /** Стартовый баланс в минорных единицах: обычно то, что уже лежит в кармане. */
  balance: z.number().int().nonnegative().max(1_000_000_000_00).default(0),
});
export type CreateWalletInput = z.infer<typeof createWalletSchema>;

/**
 * PATCH /api/wallets/:id — правка кошелька.
 * Оба поля опциональны: шторка шлёт только то, что менял пользователь.
 * balance — абсолютная величина (коррекция «сколько на самом деле лежит»),
 * а не дельта: пользователь вводит итоговое число, а не поправку к нему.
 */
export const updateWalletSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название').optional(),
    balance: z.number().int().nonnegative().max(1_000_000_000_00).optional(),
  })
  .refine((v) => v.name !== undefined || v.balance !== undefined, {
    message: 'Нечего сохранять',
  });
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>;

/** Потолок суммы лимита — та же граница, что у стартового баланса кошелька. */
export const MAX_LIMIT_AMOUNT = 1_000_000_000_00;

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период в формате YYYY-MM');

/**
 * Сумма запланированного бюджета. null — осознанное «лимита нет»: им фронт
 * снимает ранее заданный план, и это не то же самое, что отсутствие поля
 * («не трогай лимит») в PATCH.
 */
const limitAmountSchema = z
  .number()
  .int('Лимит — в минорных единицах (integer)')
  .nonnegative('Лимит не может быть отрицательным')
  .max(MAX_LIMIT_AMOUNT, 'Слишком большой лимит — проверьте сумму');

/** POST /api/categories — новая категория расхода или источник дохода */
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название'),
  kind: z.enum(['income', 'expense']),
  icon: z.enum(CATEGORY_ICONS as unknown as [string, ...string[]]).optional(),
  color: z.enum(CATEGORY_COLORS as unknown as [string, ...string[]]).optional(),
  /**
   * Запланированный бюджет на текущий период. Задаётся сразу при создании,
   * чтобы не заставлять пользователя открывать вторую форму ради одной суммы.
   * Для источников дохода игнорируется: план расходов у них не бывает.
   */
  limitAmount: limitAmountSchema.optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/**
 * PATCH /api/categories/:id — правка категории и её плана.
 * Все поля опциональны: шторка шлёт только то, что пользователь менял.
 */
export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название').optional(),
  icon: z.enum(CATEGORY_ICONS as unknown as [string, ...string[]]).optional(),
  color: z.enum(CATEGORY_COLORS as unknown as [string, ...string[]]).optional(),
  /** Период правки лимита. Без него — текущий период пользователя. */
  period: periodSchema.optional(),
  /** null снимает лимит, число — задаёт, отсутствие поля — не трогает. */
  limitAmount: limitAmountSchema.nullable().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** PUT /api/categories/:id/limit — установка лимита на период */
export const setLimitSchema = z.object({
  period: periodSchema,
  limitAmount: limitAmountSchema,
});
export type SetLimitInput = z.infer<typeof setLimitSchema>;

/** Ответ аналитики: распределение по категориям (donut) */
export interface CategoryDistributionItem {
  categoryId: string;
  name: string;
  color: string | null;
  icon: string | null;
  spent: number;
  limit: number | null;
  /** Доля в общих тратах периода, 0..1 */
  share: number;
  isOverdraft: boolean;
}

export interface DistributionResponse {
  period: string;
  total: number;
  items: CategoryDistributionItem[];
}

/** Ответ аналитики: velocity — факт нарастающим итогом против равномерной кривой */
export interface VelocityPoint {
  day: string;
  spent: number;
  cumulative: number;
  ideal: number;
}

export interface VelocityResponse {
  period: string;
  total: number;
  /** Сумма лимитов категорий за период (база идеальной кривой), null если лимитов нет */
  budget: number | null;
  points: VelocityPoint[];
  /** Опережение факта над идеалом на сегодня (минорные единицы); >0 = тратим быстрее плана */
  pace: number;
}

/**
 * Прогноз исчерпания бюджета (burn rate).
 *
 * ON_TRACK — при нынешнем темпе бюджета хватит до конца периода;
 * TIGHT — хватит впритык (запас меньше пары дней);
 * SHORTFALL — кончится раньше конца периода;
 * NO_BUDGET — лимиты не заданы, прогнозировать не от чего;
 * NO_SPEND — за последнюю неделю трат не было, темп нулевой.
 */
export type ForecastVerdict = 'ON_TRACK' | 'TIGHT' | 'SHORTFALL' | 'NO_BUDGET' | 'NO_SPEND';

/** Сколько полных дней берём в расчёт среднего темпа. */
export const BURN_RATE_WINDOW_DAYS = 7;

/** Запас в днях, ниже которого прогноз считается «впритык». */
export const FORECAST_TIGHT_DAYS = 2;

export interface ForecastResponse {
  period: string;
  verdict: ForecastVerdict;
  /** Средняя трата в день по окну наблюдения, минорные единицы. */
  dailyBurn: number;
  /** Сколько полных дней реально попало в окно (меньше 7 у новых профилей). */
  windowDays: number;
  /** Сумма лимитов периода; null — лимитов нет. */
  budget: number | null;
  spent: number;
  /**
   * Неоплаченные обязательства календаря до конца периода. Вычтены из остатка:
   * деньги, которые точно уйдут за аренду, свободными считать нельзя.
   */
  upcoming: number;
  /** Остаток бюджета за вычетом обязательств; null без лимитов. */
  remaining: number | null;
  /** Через сколько дней кончится бюджет при нынешнем темпе; null — не определить. */
  daysLeftAtBurn: number | null;
  /** Сколько дней осталось в расчётном периоде. */
  daysLeftInPeriod: number;
}

/** Дни без трат за период и серии. */
export interface NoSpendResponse {
  period: string;
  /** Даты YYYY-MM-DD, в которые не было ни одного расхода. */
  days: string[];
  /** Серия, идущая прямо сейчас (включая сегодня, пока трат нет). */
  currentStreak: number;
  /** Самая длинная серия внутри периода. */
  bestStreak: number;
  /** Всего дней без трат в периоде. */
  total: number;
}

/** PATCH /api/settings — день начала расчётного месяца */
export const updateSettingsSchema = z.object({
  monthStartDay: z
    .number()
    .int()
    .min(MIN_MONTH_START_DAY)
    .max(MAX_MONTH_START_DAY, `День начала месяца — от 1 до ${MAX_MONTH_START_DAY}`),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * POST /api/settings/currency — смена валюты с пересчётом сумм.
 * Курс: сколько единиц новой валюты в одной единице текущей.
 */
export const changeCurrencySchema = z.object({
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  rate: z
    .number()
    .positive('Курс должен быть больше нуля')
    .max(100_000, 'Слишком большой курс — проверьте значение'),
});
export type ChangeCurrencyInput = z.infer<typeof changeCurrencySchema>;

/** POST /api/export — выгрузка операций файлом в чат бота */
export const exportRequestSchema = z.object({
  /** Начало диапазона (ISO). Без него — с первой операции. */
  from: z.string().datetime().optional(),
  /** Конец диапазона (ISO, не включая). Без него — по настоящий момент. */
  to: z.string().datetime().optional(),
});
export type ExportRequestInput = z.infer<typeof exportRequestSchema>;

export interface SettingsResponse {
  currency: string;
  monthStartDay: number;
  /** Границы текущего периода — чтобы UI показал, какой отрезок получился. */
  period: string;
  periodStart: string;
  periodEnd: string;
  /** Профиль, к которому относятся настройки. */
  profileId: string;
  profileName: string;
}

/**
 * Сколько профилей на аккаунт. Ограничение не техническое, а смысловое:
 * список переключения должен читаться с одного взгляда.
 */
export const MAX_PROFILES = 8;

/** POST /api/profiles — новый профиль бюджета */
export const createProfileSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название'),
  /** Не указана — берём валюту текущего профиля. */
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
  monthStartDay: z
    .number()
    .int()
    .min(MIN_MONTH_START_DAY)
    .max(MAX_MONTH_START_DAY, `День начала месяца — от 1 до ${MAX_MONTH_START_DAY}`)
    .optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/** PATCH /api/profiles/:id — переименование */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название'),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Фильтры ленты истории. */
export interface HistoryFilters {
  from?: string;
  to?: string;
  type?: TransactionType;
  categoryId?: string;
}

export interface HistoryTotals {
  income: number;
  expense: number;
  count: number;
}

export const dndResultSchema = z.object({
  transactionId: z.string().uuid(),
  /** Баланс кошелька-источника (для зачисления — он же и получатель). */
  walletBalance: z.number().int(),
  /** Баланс кошелька-получателя перевода; null для остальных операций. */
  toWalletBalance: z.number().int().nullable(),
  categorySpent: z.number().int(),
  categoryLimit: z.number().int().nullable(),
  isOverdraft: z.boolean(),
});
export type DndResult = z.infer<typeof dndResultSchema>;

/** Горизонт календаря — та же глубина, что у карусели дней. */
export const PLANNED_WINDOW_DAYS = 30;

/** Сколько правил на профиль. Ограничение смысловое: календарь должен читаться. */
export const MAX_PLANNED = 30;

const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD');

/** POST /api/planned — новое событие календаря */
export const createPlannedSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите название').max(40, 'Слишком длинное название'),
    amount: amountSchema,
    categoryId: z.string().uuid().nullish(),
    walletId: z.string().uuid().nullish(),
    recurrence: z.enum(['once', 'monthly']),
    dueDate: dueDateSchema.optional(),
    /** 1–28: 30-го числа в феврале не существует, и событие пропадало бы раз в год. */
    dueDay: z.number().int().min(1).max(28).optional(),
  })
  .refine(
    (v) =>
      v.recurrence === 'once'
        ? Boolean(v.dueDate) && v.dueDay === undefined
        : v.dueDay !== undefined && !v.dueDate,
    { message: 'Разовому событию нужна дата, ежемесячному — число месяца' },
  );
export type CreatePlannedInput = z.infer<typeof createPlannedSchema>;

/** PATCH /api/planned/:id — правка суммы, названия или расписания */
export const updatePlannedSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  amount: amountSchema.optional(),
  categoryId: z.string().uuid().nullish(),
  walletId: z.string().uuid().nullish(),
  dueDate: dueDateSchema.optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  active: z.boolean().optional(),
});
export type UpdatePlannedInput = z.infer<typeof updatePlannedSchema>;

/** POST /api/planned/:id/confirm | /skip — решение по конкретной дате */
export const settlePlannedSchema = z.object({ dueDate: dueDateSchema });
export type SettlePlannedInput = z.infer<typeof settlePlannedSchema>;

/**
 * Сводка календаря: сколько денег на самом деле свободно.
 *
 * `free` — то самое «сколько я могу потратить сегодня»: баланс за вычетом
 * обязательств, которые ещё предстоит оплатить до конца расчётного периода.
 */
export interface PlannedSummary {
  period: string;
  balance: number;
  /** Неоплаченные обязательства до конца периода. */
  upcoming: number;
  free: number;
  /** Ближайшее неоплаченное событие, если есть. */
  nextDueDate: string | null;
  nextName: string | null;
}
