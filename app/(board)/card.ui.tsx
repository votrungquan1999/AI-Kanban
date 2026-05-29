"use client";

import type { Card } from "@/cards/card.type";

/**
 * Renders a single card tile showing its number, title, and priority.
 * @param card - The card to display.
 */
export function CardTile({ card }: { card: Card }) {
  return (
    <article className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-gray-400">#{card.number}</div>
      <div className="text-sm font-medium text-gray-900">{card.title}</div>
      <div className="text-xs text-gray-500">priority {card.priority}</div>
    </article>
  );
}
