"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BoardSettingsDialog } from "./board-settings.ui";

interface BoardShellProps {
  title: string;
  addTaskHref: string;
  defaultIntervalMs: number;
  updateDefaultIntervalAction: (intervalMs: number) => Promise<void>;
  children: ReactNode;
}

/**
 * Page chrome for the board: heading, the board-settings + add-task triggers,
 * and background.
 * @param title - Heading text (provided by the server).
 * @param addTaskHref - Link that opens the add-task dialog.
 * @param defaultIntervalMs - Current board default block interval (for settings).
 * @param updateDefaultIntervalAction - Persists a new default block interval.
 * @param children - The board content.
 */
export function BoardShell({
  title,
  addTaskHref,
  defaultIntervalMs,
  updateDefaultIntervalAction,
  children,
}: BoardShellProps) {
  return (
    <main className="grid min-h-screen content-start bg-background">
      <header className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          <BoardSettingsDialog
            defaultIntervalMs={defaultIntervalMs}
            updateAction={updateDefaultIntervalAction}
          />
          <Button nativeButton={false} render={<Link href={addTaskHref} />}>
            Add task
          </Button>
        </div>
      </header>
      {children}
    </main>
  );
}
