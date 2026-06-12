"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatRelativeAge } from "@/lib/relative-time";
import type { RecurringTask } from "@/recurring/recurring.type";
import { formatSchedule } from "./format-schedule";
import { recurringDetailHref } from "./href";

/**
 * Renders a single recurring-task tile: the number, the title, the schedule
 * label (from `everyHours`), the current run state, and the relative age. The
 * surface shows every state (idle/running/failed), so the state is surfaced
 * verbatim for the operator.
 * @param task - The recurring task to display.
 * @param now - Reference time for the relative age (defaults to render time;
 *   injected in tests for determinism).
 */
export function RecurringTaskTile({
  task,
  now,
}: {
  task: RecurringTask;
  now?: Date;
}) {
  const reference = now ?? new Date();

  return (
    <Card className="grid gap-2 rounded-lg border-border bg-card p-3 shadow-sm">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-muted-foreground">
        <span>#{task.number}</span>
        <span
          data-testid="tile-state"
          className="rounded bg-muted px-1.5 py-0.5"
        >
          {task.runState}
        </span>
      </div>

      <Link
        href={recurringDetailHref(task.id)}
        className="line-clamp-2 text-sm font-medium wrap-break-word text-card-foreground hover:underline"
      >
        {task.title}
      </Link>

      <div className="grid grid-flow-col items-center justify-start gap-2 text-xs text-muted-foreground">
        <span
          data-testid="tile-schedule"
          className="rounded bg-muted px-1.5 py-0.5"
        >
          {formatSchedule(task.everyHours)}
        </span>
        <span data-testid="tile-age">
          {formatRelativeAge(task.createdAt, reference)}
        </span>
      </div>
    </Card>
  );
}
