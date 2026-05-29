"use client";

import type { ReactNode } from "react";

interface BoardShellProps {
  title: string;
  addTaskHref: string;
  children: ReactNode;
}

/**
 * Page chrome for the board: heading, the add-task trigger, and background.
 * @param title - Heading text (provided by the server).
 * @param addTaskHref - Link that opens the add-task dialog.
 * @param children - The board content.
 */
export function BoardShell({ title, addTaskHref, children }: BoardShellProps) {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between px-4 pt-4">
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        <a
          href={addTaskHref}
          className="rounded bg-gray-900 px-3 py-1 text-sm text-white"
        >
          Add task
        </a>
      </header>
      {children}
    </main>
  );
}
