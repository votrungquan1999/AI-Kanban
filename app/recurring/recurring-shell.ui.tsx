"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface RecurringShellProps {
  title: string;
  addRecurringHref: string;
  children: ReactNode;
}

/**
 * Page chrome for the recurring surface: heading, the add-recurring trigger,
 * and background. Pure display; the server supplies the title, the trigger
 * href, and the composed list of tiles as children.
 * @param title - Heading text (provided by the server).
 * @param addRecurringHref - Link that opens the add-recurring dialog.
 * @param children - The recurring-task tiles.
 */
export function RecurringShell({
  title,
  addRecurringHref,
  children,
}: RecurringShellProps) {
  return (
    <main className="grid min-h-screen content-start bg-background">
      <header className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <Button nativeButton={false} render={<Link href={addRecurringHref} />}>
          New recurring task
        </Button>
      </header>
      {children}
    </main>
  );
}
