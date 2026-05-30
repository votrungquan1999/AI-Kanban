"use client";

import type { Card as CardData } from "@/cards/card.type";
import { Card } from "@/components/ui/card";

/**
 * Renders a single card tile: number + priority on top, title below. Styled to
 * stand out against the tinted lane and to read as draggable.
 * @param card - The card to display.
 */
export function CardTile({ card }: { card: CardData }) {
  return (
    <Card className="grid cursor-grab gap-2 rounded-lg border-border bg-card p-3 shadow-sm transition-colors hover:border-ring active:cursor-grabbing">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-muted-foreground">
        <span>#{card.number}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
          P{card.priority}
        </span>
      </div>
      <div className="text-sm font-medium text-card-foreground">
        {card.title}
      </div>
    </Card>
  );
}
