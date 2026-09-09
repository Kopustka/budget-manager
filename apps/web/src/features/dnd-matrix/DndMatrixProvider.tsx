import { useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { resolveMatrix, type NodeKind } from '@budget/shared';
import { parseNodeId, useDndStore } from '@/stores/useDndStore';
import { useUiStore } from '@/stores/useUiStore';
import { haptics } from '@/shared/lib/telegram';
import { GlassCard } from '@/shared/ui/GlassCard';

/**
 * Контекст Drag-and-Drop матрицы.
 *
 * Правила берём из `resolveMatrix` в packages/shared — того же модуля, которым
 * бэкенд проверяет операцию. Запрещённый жест не отправляется на сервер вовсе:
 * карточка пружиной возвращается на место (dnd-kit делает это сам, раз мы не
 * меняем состояние), пользователь получает haptic error и объяснение причины.
 */
export function DndMatrixProvider({ children }: { children: ReactNode }) {
  const { setDragging, openOperation } = useDndStore();
  const selectedDay = useUiStore((s) => s.selectedDay);
  const notify = useUiStore((s) => s.notify);
  const [overlay, setOverlay] = useState<{ kind: NodeKind; label: string } | null>(null);

  // Задержка активации: короткое касание остаётся тапом/скроллом, и только
  // удержание начинает перетаскивание — иначе лента перестаёт скроллиться.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const node = parseNodeId(String(event.active.id));
    if (!node) return;
    setDragging(node);
    setOverlay({
      kind: node.kind,
      label: String(event.active.data.current?.label ?? ''),
    });
    haptics.impact('light');
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    setOverlay(null);

    const source = parseNodeId(String(event.active.id));
    const target = event.over ? parseNodeId(String(event.over.id)) : null;
    if (!source || !target) return;

    const matrix = resolveMatrix(source.kind, target.kind);
    if (!matrix.allowed || !matrix.action) {
      haptics.error();
      notify(matrix.reason ?? 'Так нельзя', 'error');
      return;
    }

    if (matrix.action === 'transfer') {
      // Кошелёк, брошенный сам на себя, — промах пальцем, а не операция.
      // Молча гасим: ругаться на очевидную случайность незачем.
      if (source.id === target.id) return;
      haptics.impact('medium');
      openOperation({
        action: 'transfer',
        walletId: source.id,
        toWalletId: target.id,
        occurredAt: occurredAtFor(selectedDay),
      });
      return;
    }

    // Раскладываем узлы по ролям: кто кошелёк, кто категория.
    const walletId = matrix.action === 'deposit' ? target.id : source.id;
    const categoryId = matrix.action === 'deposit' ? source.id : target.id;

    haptics.impact('medium');
    openOperation({
      action: matrix.action,
      walletId,
      categoryId,
      occurredAt: occurredAtFor(selectedDay),
    });
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setOverlay(null);
      }}
    >
      {children}
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }}>
        {overlay ? (
          <GlassCard className="px-4 py-3 text-sm font-medium shadow-2xl">
            {overlay.label || 'Перетаскивание'}
          </GlassCard>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Подпись узла для озвучки; по умолчанию dnd-kit читает сырой id вида `income:uuid`. */
function labelOf(data: unknown): string {
  const label = (data as { label?: string } | null | undefined)?.label;
  return label && label.trim() ? label : 'элемент';
}

/**
 * Анонсы для скринридера. Без них жест матрицы недоступен незрячим:
 * dnd-kit озвучивает идентификаторы, а не смысл операции.
 */
const announcements = {
  onDragStart: ({ active }: { active: { data: { current: unknown } } }) =>
    `Взяли ${labelOf(active.data.current)}. Ведите к цели и отпустите.`,
  onDragOver: ({ active, over }: { active: { data: { current: unknown } }; over: { data: { current: unknown } } | null }) => {
    if (!over) return `${labelOf(active.data.current)} вне цели.`;
    const source = active.data.current as { kind?: NodeKind } | null;
    const target = over.data.current as { kind?: NodeKind } | null;
    if (!source?.kind || !target?.kind) return undefined;
    const matrix = resolveMatrix(source.kind, target.kind);
    return matrix.allowed
      ? `Над целью ${labelOf(over.data.current)}. Отпустите, чтобы продолжить.`
      : `Цель ${labelOf(over.data.current)} недоступна. ${matrix.reason ?? ''}`;
  },
  onDragEnd: ({ active, over }: { active: { data: { current: unknown } }; over: { data: { current: unknown } } | null }) =>
    over
      ? `${labelOf(active.data.current)} перенесён на ${labelOf(over.data.current)}.`
      : `Перенос ${labelOf(active.data.current)} отменён.`,
  onDragCancel: ({ active }: { active: { data: { current: unknown } } }) =>
    `Перенос ${labelOf(active.data.current)} отменён.`,
};

const screenReaderInstructions = {
  draggable:
    'Нажмите пробел или Enter, чтобы взять элемент. Стрелками ведите к цели: доход — в кошелёк, кошелёк — в категорию расхода, кошелёк — в другой кошелёк для перевода. Пробел подтверждает, Escape отменяет.',
};

/**
 * Дата операции. Для сегодняшнего дня — текущий момент, для прошлого —
 * полдень UTC: так операция гарантированно попадает в нужные сутки в любом поясе.
 */
export function occurredAtFor(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return day === today ? new Date().toISOString() : `${day}T12:00:00.000Z`;
}
