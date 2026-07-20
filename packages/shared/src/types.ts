/** Доменные типы. Совпадают со схемой PostgreSQL (source of truth). */

export type UUID = string;
/** Денежные суммы храним в минорных единицах (копейках) — integer, без float. */
export type MinorAmount = number;

/**
 * Telegram-личность. Данных бюджета не держит: областью видимости для кошельков,
 * категорий и операций служит профиль — их у одного аккаунта может быть несколько.
 */
export interface User {
  id: UUID;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  /** Профиль, который сейчас открыт. null только до создания первого. */
  activeProfileId: UUID | null;
  createdAt: string;
}

/**
 * Профиль — независимый бюджет: свои кошельки, категории, операции и лимиты.
 *
 * Валюта и день начала месяца живут здесь, а не на пользователе: «Бизнес в
 * долларах» рядом с «Личным в рублях» — основной смысл нескольких профилей.
 */
export interface Profile {
  id: UUID;
  userId: UUID;
  name: string;
  /** Валюта отображения. Суммы хранятся в минорных единицах этой валюты. */
  currency: string;
  /**
   * День начала расчётного месяца (1–28). Период с меткой YYYY-MM начинается
   * этим числом и заканчивается им же в следующем месяце (не включая).
   */
  monthStartDay: number;
  createdAt: string;
}

export interface Wallet {
  id: UUID;
  profileId: UUID;
  name: string;
  /** Текущий баланс в минорных единицах */
  balance: MinorAmount;
  currency: string;
  createdAt: string;
}

export interface Category {
  id: UUID;
  profileId: UUID;
  name: string;
  /** income = источник дохода, expense = категория расхода */
  kind: 'income' | 'expense';
  icon: string | null;
  color: string | null;
  createdAt: string;
}

export interface CategoryLimit {
  id: UUID;
  categoryId: UUID;
  /** Период лимита, формат YYYY-MM */
  period: string;
  limitAmount: MinorAmount;
}

export type TransactionType = 'deposit' | 'spend';

export interface Transaction {
  id: UUID;
  profileId: UUID;
  type: TransactionType;
  walletId: UUID | null;
  categoryId: UUID | null;
  subcategory: string | null;
  amount: MinorAmount;
  comment: string | null;
  /** Дата события (может быть задним числом из карусели) */
  occurredAt: string;
  createdAt: string;
}
