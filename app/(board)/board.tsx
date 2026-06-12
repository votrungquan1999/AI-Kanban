"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { startTransition, useOptimistic } from "react";
import type { Status } from "@/cards/card.type";
import { applyOptimisticMove } from "./board.move";
import type { BoardColumnView } from "./board.type";
import { BoardLayout } from "./board-layout.ui";
import { DraggableCard } from "./draggable-card.ui";
import { DroppableColumn } from "./droppable-column.ui";

interface BoardProps {
  columns: BoardColumnView[];
  moveAction: (cardId: string, toStatus: Status) => Promise<void>;
  blockAction: (cardId: string, intervalMs: number) => Promise<void>;
  stillBlockedAction: (cardId: string) => Promise<void>;
  defaultIntervalMs: number;
}

/**
 * The four-column board with drag-to-move. Dropping a card optimistically
 * relocates it, then calls `moveAction`; if the action fails, React's
 * `useOptimistic` reverts to the server-confirmed columns.
 * @param columns - Server-confirmed columns.
 * @param moveAction - Server action that persists a card's new status.
 */
export function Board({
  columns,
  moveAction,
  blockAction,
  stillBlockedAction,
  defaultIntervalMs,
}: BoardProps) {
  const [optimisticColumns, applyMove] = useOptimistic(
    columns,
    applyOptimisticMove,
  );
  const sensors = useSensors(useSensor(PointerSensor));

  function handleDragEnd(event: DragEndEvent) {
    const toStatus = event.over?.id as Status | undefined;
    if (!toStatus) {
      return;
    }

    const cardId = String(event.active.id);
    startTransition(async () => {
      applyMove({ cardId, toStatus });
      await moveAction(cardId, toStatus);
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <BoardLayout>
        {optimisticColumns.map((column) => (
          <DroppableColumn
            key={column.status}
            status={column.status}
            title={column.title}
            count={column.cards.length}
          >
            {column.cards.map((card) => (
              <DraggableCard
                key={card.id}
                card={card}
                blockAction={blockAction}
                stillBlockedAction={stillBlockedAction}
                defaultIntervalMs={defaultIntervalMs}
              />
            ))}
          </DroppableColumn>
        ))}
      </BoardLayout>
    </DndContext>
  );
}
