"use client";

import type { Card as CardData } from "@/cards/card.type";
import { Card } from "@/components/ui/card";

/**
 * Renders a single card tile showing its number, title, and priority.
 * @param card - The card to display.
 */
export function CardTile({ card }: { card: CardData }) {
  return (
    <Card className="grid gap-1 p-3">
      <div className="text-xs text-muted-foreground">#{card.number}</div>
      <div className="text-sm font-medium text-card-foreground">
        {card.title}
      </div>
      <div className="text-xs text-muted-foreground">
        priority {card.priority}
      </div>
    </Card>
  );
}
