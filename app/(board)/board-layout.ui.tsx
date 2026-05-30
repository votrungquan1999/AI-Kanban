"use client";

import type { ReactNode } from "react";

/**
 * Horizontal, scrollable row that lays out the board columns.
 * @param children - The column elements.
 */
export function BoardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-flow-col auto-cols-max gap-4 overflow-x-auto p-4">
      {children}
    </div>
  );
}
