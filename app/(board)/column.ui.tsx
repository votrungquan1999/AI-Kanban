"use client";

import type { ReactNode } from "react";

interface ColumnProps {
  title: string;
  children: ReactNode;
}

/**
 * Renders a board column: a heading above its stacked card children.
 * @param title - Column heading text.
 * @param children - The column's card tiles.
 */
export function Column({ title, children }: ColumnProps) {
  return (
    <section className="grid w-72 shrink-0 content-start gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="grid min-h-8 content-start gap-2">{children}</div>
    </section>
  );
}
