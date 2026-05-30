"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
    <main className="grid min-h-screen content-start bg-background">
      <header className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 pt-4">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <Button render={<a href={addTaskHref}>Add task</a>} />
      </header>
      {children}
    </main>
  );
}
