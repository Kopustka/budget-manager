/** Уведомления, которые бот отправляет пользователю. */

export interface AlertBase {
  /** Кому слать: Telegram ID (chat_id личного чата с ботом). */
  telegramId: number;
  /**
   * Профиль, к которому относится событие. Дедупликатор строится по нему:
   * один и тот же лимит в разных профилях — разные поводы для пуша.
   */
  profileId: string;
  /** Валюта на момент постановки в очередь — текст пуша не должен зависеть от поздней смены. */
  currency: string;
  /** Момент постановки в очередь, ISO. */
  queuedAt: string;
}

/** Траты по категории достигли лимита периода. */
export interface LimitReachedAlert extends AlertBase {
  kind: 'limit_reached';
  categoryName: string;
  spent: number;
  limit: number;
}

/** Лимит категории превышен. */
export interface OverdraftAlert extends AlertBase {
  kind: 'overdraft';
  categoryName: string;
  spent: number;
  limit: number;
}

/** За сегодня потрачено заметно больше равномерной дневной доли бюджета. */
export interface FastPaceAlert extends AlertBase {
  kind: 'fast_pace';
  spentToday: number;
  dailyBudget: number;
}

/** Одна трата дня в вечернем отчёте. */
export interface DigestSpend {
  /** Название категории; null — категория удалена или не указана. */
  category: string | null;
  subcategory: string | null;
  amount: number;
  comment: string | null;
}

/**
 * Вечерний отчёт «День в цифрах».
 *
 * В очередь кладётся только адресация: цифры подставляются при доставке
 * (`hydrateAlert`). Планировщик срабатывает задолго до времени отправки, и
 * посчитанные им суммы к вечеру успели бы устареть.
 */
export interface DailyDigestAlert extends AlertBase {
  kind: 'daily_digest';
  /** День отчёта, YYYY-MM-DD. */
  day: string;
  /** Потрачено за день. Заполняется при доставке. */
  spentToday?: number;
  /** Все траты дня по порядку — «категория — сумма — на что». */
  spends?: DigestSpend[];
  /** Суммарный остаток на кошельках профиля в момент отправки. */
  walletsTotal?: number;
  /** Сумма лимитов периода; null — лимиты не заданы. */
  budget?: number | null;
  /** Остаток бюджета на месяц; null без лимитов. Отрицательный — перерасход. */
  remaining?: number | null;
  /** Есть ли категории, вышедшие за свой лимит. */
  overLimit?: boolean;
  /** Текущая серия дней без трат — нужна, когда за день не потрачено ничего. */
  noSpendStreak?: number;
}

/** Завтра списание по календарю обязательств. */
export interface PlannedDueAlert extends AlertBase {
  kind: 'planned_due';
  /** Название события: «VPN», «Аренда». */
  name: string;
  amount: number;
  /** Дата списания, YYYY-MM-DD. */
  dueDate: string;
}

export type BotAlert =
  | LimitReachedAlert
  | OverdraftAlert
  | FastPaceAlert
  | DailyDigestAlert
  | PlannedDueAlert;
