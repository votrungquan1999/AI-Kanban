// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecurringOutcome,
  RecurringRunState,
  type RecurringTask,
} from "@/recurring/recurring.type";
import type { RecurringRun } from "@/recurring/recurring-run.mapper";
import { RecurringDetail } from "./recurring-detail.ui";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

/**
 * Builds a client recurring task for detail rendering tests; override per scenario.
 */
function makeTask(partial: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: "0123456789abcdef01234567",
    number: 3,
    title: "Nightly digest",
    instruction: "Summarise the day",
    everyHours: 24,
    enabled: true,
    runState: RecurringRunState.Idle,
    nextDueAt: "2026-01-03T00:00:00.000Z",
    lastRunAt: null,
    lastOutcome: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

/**
 * Builds a client run-history row; override per scenario.
 */
function makeRun(partial: Partial<RecurringRun> = {}): RecurringRun {
  return {
    id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    recurringId: "0123456789abcdef01234567",
    at: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.000Z",
    outcome: RecurringOutcome.Success,
    note: "ran clean",
    ...partial,
  };
}

afterEach(() => {
  replace.mockClear();
  vi.restoreAllMocks();
});

describe("RecurringDetail", () => {
  it("renders each run's note/error and relative age in the timeline", async () => {
    const now = new Date("2026-01-03T00:00:00.000Z");
    const runs: RecurringRun[] = [
      makeRun({
        id: "run-success",
        at: "2026-01-01T00:00:00.000Z",
        outcome: RecurringOutcome.Success,
        note: "ran clean",
        error: undefined,
      }),
      makeRun({
        id: "run-failure",
        at: "2026-01-02T22:00:00.000Z",
        outcome: RecurringOutcome.Failure,
        note: undefined,
        error: "boom: timeout",
      }),
    ];

    render(
      <RecurringDetail task={makeTask()} runs={runs} open={true} now={now} />,
    );

    expect(await screen.findByText("ran clean")).toBeInTheDocument();
    expect(screen.getByText("boom: timeout")).toBeInTheDocument();
    expect(screen.getByText("2 days ago")).toBeInTheDocument();
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("shows an empty-history placeholder when the task has no runs", async () => {
    render(<RecurringDetail task={makeTask()} runs={[]} open={true} />);

    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
  });

  it("renders a failed task distinctly with its failure reason", async () => {
    const task = makeTask({
      runState: RecurringRunState.Failed,
      failureReason: "exit code 1: missing token",
    });

    render(<RecurringDetail task={task} runs={[]} open={true} />);

    expect(
      await screen.findByText("exit code 1: missing token"),
    ).toBeInTheDocument();
  });

  it("submits the fix note via the injected action", async () => {
    const setFixNoteAction = vi.fn(async () => {});
    const task = makeTask({
      runState: RecurringRunState.Failed,
      failureReason: "boom",
    });

    render(
      <RecurringDetail
        task={task}
        runs={[]}
        open={true}
        setFixNoteAction={setFixNoteAction}
      />,
    );

    const noteInput = await screen.findByRole("textbox", { name: /fix note/i });
    await userEvent.type(noteInput, "rotate the token");
    await userEvent.click(
      screen.getByRole("button", { name: /save fix note/i }),
    );

    expect(setFixNoteAction).toHaveBeenCalledWith(task.id, "rotate the token");
  });

  it("resets the task to due via the injected action after confirmation", async () => {
    const resetToDueAction = vi.fn(async () => {});
    const task = makeTask({
      runState: RecurringRunState.Failed,
      failureReason: "boom",
    });

    render(
      <RecurringDetail
        task={task}
        runs={[]}
        open={true}
        resetToDueAction={resetToDueAction}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /reset to due/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /confirm reset/i }),
    );

    expect(resetToDueAction).toHaveBeenCalledWith(task.id);
    expect(replace).toHaveBeenCalledWith("/recurring");
  });

  it("does not show the fix-note or reset controls for a non-failed task", async () => {
    const setFixNoteAction = vi.fn(async () => {});
    const resetToDueAction = vi.fn(async () => {});

    render(
      <RecurringDetail
        task={makeTask({ runState: RecurringRunState.Idle })}
        runs={[]}
        open={true}
        setFixNoteAction={setFixNoteAction}
        resetToDueAction={resetToDueAction}
      />,
    );

    // The drawer body is present (title renders) but neither control appears.
    expect(await screen.findByText("Nightly digest")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /fix note/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset to due/i }),
    ).not.toBeInTheDocument();
  });
});
