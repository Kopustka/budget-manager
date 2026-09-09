import type { ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { resolveMatrix, type NodeKind } from '@budget/shared';
import { nodeId } from '@/stores/useDndStore';
import { useDndStore } from '@/stores/useDndStore';
import { cn } from '@/shared/ui/cn';

/**
 * Тонкие обёртки над dnd-kit. Компоненты экрана остаются про верстку,
 * а правила матрицы применяются в одном месте.
 */

interface DragNodeProps {
  kind: NodeKind;
  id: string;
  children: ReactNode;
  className?: string;
  /** Доступная подпись: без неё узел не понять с клавиатуры/скринридера. */
  label: string;
}

export function DragNode({ kind, id, children, className, label }: DragNodeProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: nodeId(kind, id),
    // label едет в data, чтобы DragOverlay мог отрисовать понятную «летящую» карточку.
    data: { kind, id, label },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={label}
      className={cn(
        'touch-none',
        // Оригинал приглушаем, но НЕ убираем: иначе layout прыгает под пальцем.
        isDragging && 'opacity-40',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface DropNodeProps {
  kind: NodeKind;
  id: string;
  /** Рендер-функция получает состояние цели, чтобы карточка сама решила, как подсветиться. */
  children: (state: { isOver: boolean; isAllowed: boolean; isActive: boolean }) => ReactNode;
  className?: string;
}

export function DropNode({ kind, id, children, className }: DropNodeProps) {
  const dragging = useDndStore((s) => s.dragging);
  const { setNodeRef, isOver } = useDroppable({ id: nodeId(kind, id), data: { kind, id } });

  // Пока идёт жест, сразу видно, какие цели допустимы — это дешевле, чем
  // дать пользователю уронить карточку и получить отказ.
  const isActive = dragging !== null;
  // Кошелёк сам себе не цель: с приходом переводов матрица разрешает
  // wallet → wallet, и без этой проверки источник подсвечивался бы как
  // допустимая цель, обещая операцию, которой не будет.
  const isSelf = dragging?.kind === kind && dragging.id === id;
  const isAllowed = isActive && !isSelf ? resolveMatrix(dragging.kind, kind).allowed : false;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'transition-opacity duration-[var(--duration-fast)]',
        isActive && !isAllowed && 'opacity-35',
        className,
      )}
    >
      {children({ isOver, isAllowed, isActive })}
    </div>
  );
}
