/** Доменные типы. Совпадают со схемой PostgreSQL (source of truth). */

export type UUID = string;
/** Денежные суммы храним в минорных единицах (копейках) — integer, без float. */
export type MinorAmount = number;

export interface User {
  id: UUID;
  telegramId: number;
  username: string | null;
  firstName: string | null;
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
  userId: UUID;
  name: string;
  /** Текущий баланс в минорных единицах */
  balance: MinorAmount;
  currency: string;
  createdAt: string;
}

export interface Category {
  id: UUID;
  userId: UUID;
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
  userId: UUID;
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
