import { create } from 'zustand';
import type { DndAction, NodeKind } from '@budget/shared';

/**
 * Состояние жеста матрицы: что тащим сейчас и какая операция ждёт ввода суммы.
 * Вынесено из компонентов, чтобы карточки-цели могли подсветиться, не зная,
 * кто именно инициировал перетаскивание.
 */

/** Идентификатор узла матрицы в формате `kind:id` — общий для draggable и droppable. */
export type NodeId = `${NodeKind}:${string}`;

export function nodeId(kind: NodeKind, id: string): NodeId {
  return `${kind}:${id}`;
}

export function parseNodeId(value: string): { kind: NodeKind; id: string } | null {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (!id || (kind !== 'income' && kind !== 'wallet' && kind !== 'expense')) return null;
  return { kind, id };
}

/** Операция, для которой открыта шторка ввода суммы. */
export interface PendingOperation {
  action: DndAction;
  /** Для перевода — кошелёк-источник. */
  walletId: string;
  /** Только у перевода: куда уходят деньги. */
  toWalletId?: string;
  /** У перевода категории нет. */
  categoryId?: string;
  /** Дата события — берётся из карусели времени (может быть задним числом). */
  occurredAt: string;
}

interface DndState {
  /** Узел, который сейчас перетаскивают (null — жеста нет). */
  dragging: { kind: NodeKind; id: string } | null;
  pending: PendingOperation | null;

  setDragging: (node: { kind: NodeKind; id: string } | null) => void;
  openOperation: (operation: PendingOperation) => void;
  closeOperation: () => void;
}

export const useDndStore = create<DndState>((set) => ({
  dragging: null,
  pending: null,

  setDragging: (dragging) => set({ dragging }),
  openOperation: (pending) => set({ pending, dragging: null }),
  closeOperation: () => set({ pending: null }),
}));
