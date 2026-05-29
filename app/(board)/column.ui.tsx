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
    <section className="flex w-72 flex-shrink-0 flex-col gap-2">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <div className="flex min-h-8 flex-col gap-2">{children}</div>
    </section>
  );
}
