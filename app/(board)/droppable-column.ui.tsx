"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { Status } from "@/cards/card.type";
import { Column } from "./column.ui";

interface DroppableColumnProps {
  status: Status;
  title: string;
  count: number;
  children: ReactNode;
}

/**
 * Wraps a {@link Column} as a dnd-kit drop target keyed by its status, so a
 * dropped card's target status equals the column's status. Highlights while a
 * card hovers over it.
 * @param status - The column's status (the droppable id).
 * @param title - Column heading.
 * @param count - Number of cards in the column.
 * @param children - The column's draggable cards.
 */
export function DroppableColumn({
  status,
  title,
  count,
  children,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={isOver ? "rounded-xl ring-2 ring-ring" : undefined}
    >
      <Column title={title} count={count}>
        {children}
      </Column>
    </div>
  );
}
