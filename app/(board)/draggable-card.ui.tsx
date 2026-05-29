"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { Card } from "@/cards/card.type";
import { CardTile } from "./card.ui";

/**
 * Wraps a {@link CardTile} as a dnd-kit draggable keyed by the card id.
 * @param card - The card to render and make draggable.
 */
export function DraggableCard({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id });

  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        opacity: isDragging ? 0.6 : undefined,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardTile card={card} />
    </div>
  );
}
