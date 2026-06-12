"use client";

import { useRouter } from "next/navigation";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatRelativeAge } from "@/lib/relative-time";
import {
  RecurringOutcome,
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";
import type { RecurringRun } from "@/recurring/recurring-run.mapper";
import { recurringHref } from "./href";
import {
  RecurringFixNote,
  type SetFixNoteAction,
} from "./recurring-fix-note.ui";
import { RecurringReset, type ResetToDueAction } from "./recurring-reset.ui";

/**
 * One run-history row: the outcome label, the run's note (success) or error
 * (failure), and the relative age of the run against the injected reference.
 * @param run - The run-history row to render.
 * @param now - Reference time for the relative age (deterministic in tests).
 */
function RunHistoryRow({ run, now }: { run: RecurringRun; now: Date }) {
  const isFailure = run.outcome === RecurringOutcome.Failure;

  return (
    <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-sm">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{run.outcome}</span>
        <span>{formatRelativeAge(run.at, now)}</span>
      </div>
      {isFailure ? (
        <span className="break-words whitespace-pre-wrap text-destructive">
          {run.error}
        </span>
      ) : (
        <span className="break-words whitespace-pre-wrap text-foreground">
          {run.note}
        </span>
      )}
    </div>
  );
}

/**
 * Distinct failure section shown only for a `failed` task: a tokenized
 * destructive banner surfacing the captured failure reason, plus (when their
 * actions are injected) the fix-note form so the operator can diagnose and act.
 * @param task - The failed task (provides id, failureReason, fixNote).
 * @param setFixNoteAction - Optional server action to record a fix note.
 * @param resetToDueAction - Optional server action to reset the task to due.
 */
function FailedSection({
  task,
  setFixNoteAction,
  resetToDueAction,
}: {
  task: RecurringTask;
  setFixNoteAction?: SetFixNoteAction;
  resetToDueAction?: ResetToDueAction;
}) {
  return (
    <div className="grid gap-2">
      <div
        data-testid="failed-banner"
        className="grid gap-1 rounded-md border border-destructive bg-destructive/10 p-2"
      >
        <span className="text-xs font-medium text-destructive">Failed</span>
        {task.failureReason ? (
          <span className="text-sm break-words whitespace-pre-wrap text-destructive">
            {task.failureReason}
          </span>
        ) : null}
      </div>

      {setFixNoteAction ? (
        <RecurringFixNote
          taskId={task.id}
          fixNote={task.fixNote}
          setFixNoteAction={setFixNoteAction}
        />
      ) : null}

      {resetToDueAction ? (
        <RecurringReset taskId={task.id} resetToDueAction={resetToDueAction} />
      ) : null}
    </div>
  );
}

/**
 * The run-history timeline body: the task header followed by each run row,
 * oldest first. An empty history shows a "No runs yet" placeholder. A failed
 * task additionally renders a distinct failure banner above the timeline.
 * @param task - The recurring task being inspected.
 * @param runs - The task's run-history rows (oldest first).
 * @param now - Reference time for relative ages (deterministic in tests).
 */
function RecurringDetailBody({
  task,
  runs,
  now,
  setFixNoteAction,
  resetToDueAction,
}: {
  task: RecurringTask;
  runs: RecurringRun[];
  now: Date;
  setFixNoteAction?: SetFixNoteAction;
  resetToDueAction?: ResetToDueAction;
}) {
  const isFailed = task.runState === RecurringRunState.Failed;

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{task.title}</DrawerTitle>
        <DrawerDescription>#{task.number}</DrawerDescription>
      </DrawerHeader>

      {isFailed ? (
        <FailedSection
          task={task}
          setFixNoteAction={setFixNoteAction}
          resetToDueAction={resetToDueAction}
        />
      ) : null}

      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Run history
        </span>
        {runs.length > 0 ? (
          runs.map((run) => <RunHistoryRow key={run.id} run={run} now={now} />)
        ) : (
          <span className="text-sm text-muted-foreground">No runs yet</span>
        )}
      </div>
    </>
  );
}

/**
 * URL-driven recurring-task detail sheet (phone-first bottom drawer). Visibility
 * is driven by the `?task=<id>` URL param via `open`; dismissing it navigates
 * back to the recurring surface. Renders a read-only run-history timeline.
 * @param task - The task to show, or null when none is selected.
 * @param runs - The task's run-history rows (oldest first).
 * @param open - Whether the sheet is shown.
 * @param now - Reference time for relative ages (defaults to render time;
 *   injected in tests for determinism).
 */
export function RecurringDetail({
  task,
  runs,
  open,
  now,
  setFixNoteAction,
  resetToDueAction,
}: {
  task: RecurringTask | null;
  runs: RecurringRun[];
  open: boolean;
  now?: Date;
  setFixNoteAction?: SetFixNoteAction;
  resetToDueAction?: ResetToDueAction;
}) {
  const router = useRouter();
  const reference = now ?? new Date();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      router.replace(recurringHref());
    }
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        {task ? (
          <RecurringDetailBody
            task={task}
            runs={runs}
            now={reference}
            setFixNoteAction={setFixNoteAction}
            resetToDueAction={resetToDueAction}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
