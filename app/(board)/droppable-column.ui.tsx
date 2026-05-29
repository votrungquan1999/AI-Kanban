"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { Status } from "@/cards/card.type";
import { Column } from "./column.ui";

interface DroppableColumnProps {
  status: Status;
  title: string;
  children: ReactNode;
}

/**
 * Wraps a {@link Column} as a dnd-kit drop target keyed by its status, so a
 * dropped card's target status equals the column's status.
 * @param status - The column's status (the droppable id).
 * @param title - Column heading.
 * @param children - The column's draggable cards.
 */
export function DroppableColumn({ status, title, children }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div ref={setNodeRef} className={isOver ? "rounded-md bg-gray-100" : undefined}>
      <Column title={title}>{children}</Column>
    </div>
  );
}
