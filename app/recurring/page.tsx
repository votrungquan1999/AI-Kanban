import {
  getRecurringTask,
  listRecurringTasks,
} from "@/recurring/recurring.service";
import type { RecurringTask } from "@/recurring/recurring.type";
import {
  type RecurringRun,
  toClientRecurringRun,
} from "@/recurring/recurring-run.mapper";
import { listRecurringRuns } from "@/recurring/recurring-run.service";
import {
  createRecurringTaskAction,
  resetToDueAction,
  setFixNoteAction,
} from "./actions";
import { AddRecurringDialog } from "./add-recurring-dialog";
import { newRecurringHref } from "./href";
import { RecurringDetail } from "./recurring-detail.ui";
import { RecurringShell } from "./recurring-shell.ui";
import { RecurringTaskTile } from "./recurring-task.ui";

/** The task plus its run history resolved from the `?task=<id>` param. */
interface RecurringDetailData {
  task: RecurringTask;
  runs: RecurringRun[];
}

interface RecurringPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Resolves the `?task=<id>` param into a task and its run history. Returns null
 * for an absent, malformed, or unknown id (the reads throw on those) so a bad
 * URL just shows the surface with no sheet instead of crashing it.
 * @param taskId - The raw `?task` search param value.
 */
async function resolveDetailTask(
  taskId: string | string[] | undefined,
): Promise<RecurringDetailData | null> {
  if (typeof taskId !== "string") {
    return null;
  }
  try {
    const task = await getRecurringTask(taskId);
    const runs = await listRecurringRuns(taskId);
    return { task, runs: runs.map(toClientRecurringRun) };
  } catch {
    return null;
  }
}

/**
 * Recurring surface: reads every recurring task (all states) and renders a tile
 * per task showing its title, schedule, and current run state. Wires the
 * add-recurring dialog (`?new=task`) and the URL-driven detail sheet (`?task`),
 * resolving the latter to a task plus its run-history timeline.
 * @param searchParams - Next.js search params (async).
 */
export default async function RecurringPage({
  searchParams,
}: RecurringPageProps) {
  const params = await searchParams;
  const isAddOpen = params.new === "task";
  const tasks = await listRecurringTasks();
  const detail = await resolveDetailTask(params.task);

  return (
    <RecurringShell title="Recurring" addRecurringHref={newRecurringHref()}>
      <div className="grid gap-2 p-4">
        {tasks.map((task) => (
          <RecurringTaskTile key={task.id} task={task} />
        ))}
      </div>
      <AddRecurringDialog open={isAddOpen} action={createRecurringTaskAction} />
      <RecurringDetail
        task={detail?.task ?? null}
        runs={detail?.runs ?? []}
        open={Boolean(detail)}
        setFixNoteAction={setFixNoteAction}
        resetToDueAction={resetToDueAction}
      />
    </RecurringShell>
  );
}
