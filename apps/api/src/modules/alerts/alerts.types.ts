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

/** Вечернее напоминание записать траты. */
export interface ReminderAlert extends AlertBase {
  kind: 'evening_reminder';
}

export type BotAlert = LimitReachedAlert | OverdraftAlert | FastPaceAlert | ReminderAlert;
