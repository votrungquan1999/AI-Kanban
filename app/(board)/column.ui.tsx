"use client";

import type { ReactNode } from "react";

interface ColumnProps {
  title: string;
  count: number;
  children: ReactNode;
}

/**
 * Renders a board lane: a header (title + count) above its stacked cards,
 * inside a bordered, tinted panel so the lane is clearly visible.
 * @param title - Column heading text.
 * @param count - Number of cards in the column (shown as a badge).
 * @param children - The column's card tiles.
 */
export function Column({ title, count, children }: ColumnProps) {
  return (
    <section className="grid w-80 shrink-0 content-start gap-3 rounded-xl border border-border bg-muted/50 p-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="grid min-h-32 content-start gap-2">{children}</div>
    </section>
  );
}
