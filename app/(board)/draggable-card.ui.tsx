"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";
import type { Card } from "@/cards/card.type";
import { CardTile } from "./card.ui";

/**
 * Wraps a {@link CardTile} as a dnd-kit draggable keyed by the card id. Only the
 * grip handle activates the drag — the rest of the tile is left free so a tap on
 * the body never starts a drag (phone-first). The whole tile still moves visually
 * because `setNodeRef` + transform stay on the outer element. The tile owns its
 * own navigation links (around non-interactive content), so no wrapper anchor is
 * added here.
 * @param card - The card to render and make draggable.
 */
export function DraggableCard({ card }: { card: Card }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: card.id });

  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        opacity: isDragging ? 0.6 : undefined,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[auto_1fr] items-stretch gap-1"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label="Drag card"
        className="grid cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <CardTile card={card} />
    </div>
  );
}
