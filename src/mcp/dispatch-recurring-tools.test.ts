import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  recurringRunsCollection,
  recurringTasksCollection,
} from "@/db/collections";
import { getDb } from "@/db/mongo";
import {
  createCompleteRecurring,
  createFailRecurring,
  createListRecurringDue,
  createListRecurringRuns,
  createStartRecurring,
} from "@/mcp/dispatch-tools";
import { createRecurringTask } from "@/recurring/recurring.service";
import { useTestMongo } from "@/test/use-test-mongo";

interface ListContent {
  tasks: { id: string }[];
}

interface RunListContent {
  runs: { outcome: string; note?: string; finishedAt: string }[];
}

/**
 * Drives one full execution cycle of a recurring task through the tools:
 * backdates `nextDueAt` so the task is claimable, claims it, and completes it
 * with the given note.
 * @param id - The recurring task's hex id.
 * @param note - The completion note recorded on the run row.
 */
async function runTaskOnce(id: string, note: string): Promise<void> {
  const db = await getDb();
  await recurringTasksCollection(db).updateOne(
    { _id: new ObjectId(id) },
    { $set: { nextDueAt: new Date(Date.now() - 60_000) } },
  );
  await createStartRecurring()({ id });
  await createCompleteRecurring()({ id, note });
}

describe("recurring queue MCP tools", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
    await recurringRunsCollection(db).deleteMany({});
  });

  it("lists due tasks, claims one, and rejects a second concurrent claim with AlreadyRunning", async () => {
    // Given a created (immediately-due) task
    const created = await createRecurringTask({
      title: "tool task",
      instruction: "do it",
      everyHours: 24,
    });

    // When listing due tasks, Then it is present under structuredContent.tasks
    const listed = await createListRecurringDue()();
    expect(listed.isError).toBeUndefined();
    const content = listed.structuredContent as unknown as ListContent;
    expect(content.tasks.some((t) => t.id === created.id)).toBe(true);

    // When claimed via the tool, Then it returns running
    const start = await createStartRecurring()({ id: created.id });
    expect(start.isError).toBeUndefined();
    expect(start.structuredContent).toMatchObject({
      id: created.id,
      runState: "running",
    });

    // When claimed again, Then a readable AlreadyRunning error result comes back
    const second = await createStartRecurring()({ id: created.id });
    expect(second.isError).toBe(true);
    expect(second.structuredContent).toMatchObject({
      code: "ERR_ALREADY_RUNNING",
    });
  });

  it("completes a running task and fails another, via the tools", async () => {
    // Given two claimed (running) tasks
    const a = await createRecurringTask({
      title: "a",
      instruction: "do a",
      everyHours: 24,
    });
    const b = await createRecurringTask({
      title: "b",
      instruction: "do b",
      everyHours: 24,
    });
    await createStartRecurring()({ id: a.id });
    await createStartRecurring()({ id: b.id });

    // When one completes with a note
    const completed = await createCompleteRecurring()({ id: a.id, note: "ok" });
    expect(completed.isError).toBeUndefined();
    expect(completed.structuredContent).toMatchObject({
      id: a.id,
      runState: "idle",
      lastOutcome: "success",
    });

    // And the other fails with an error
    const failed = await createFailRecurring()({ id: b.id, error: "boom" });
    expect(failed.isError).toBeUndefined();
    expect(failed.structuredContent).toMatchObject({
      id: b.id,
      runState: "failed",
      lastOutcome: "failure",
    });
  });

  it("returns the latest 5 runs newest first by default, each with its outcome and note", async () => {
    // Given a task that has finished six runs, noted run 1 .. run 6
    const created = await createRecurringTask({
      title: "history",
      instruction: "remember me",
      everyHours: 24,
    });
    for (let i = 1; i <= 6; i++) {
      await runTaskOnce(created.id, `run ${i}`);
    }

    // When the agent pulls run history with just the task id
    const result = await createListRecurringRuns()({ id: created.id });

    // Then the latest 5 runs come back newest first, outcome and note readable
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as unknown as RunListContent;
    expect(content.runs.map((run) => run.note)).toEqual([
      "run 6",
      "run 5",
      "run 4",
      "run 3",
      "run 2",
    ]);
    expect(content.runs[0].outcome).toBe("success");
    expect(content.runs[0].finishedAt).toEqual(expect.any(String));
  });

  it("returns exactly the requested number of latest runs when the agent passes a limit", async () => {
    // Given a task that has finished four runs, noted run 1 .. run 4
    const created = await createRecurringTask({
      title: "depth",
      instruction: "pick depth",
      everyHours: 24,
    });
    for (let i = 1; i <= 4; i++) {
      await runTaskOnce(created.id, `run ${i}`);
    }

    // When the agent pulls history asking for just the 3 latest runs
    const result = await createListRecurringRuns()({
      id: created.id,
      limit: 3,
    });

    // Then exactly the 3 newest come back, newest first
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as unknown as RunListContent;
    expect(content.runs.map((run) => run.note)).toEqual([
      "run 4",
      "run 3",
      "run 2",
    ]);
  });

  it("excludes runs whose note starts with the given prefix when the agent passes excludeNotePrefix", async () => {
    // Given a task whose latest two runs are "skipped" markers over one real note
    const created = await createRecurringTask({
      title: "continuity",
      instruction: "carry state",
      everyHours: 24,
    });
    await runTaskOnce(created.id, "portfolio A");
    await runTaskOnce(created.id, "skipped — outside VN trading window");
    await runTaskOnce(created.id, "skipped — outside VN trading window");

    // When the agent reads history asking to exclude the "skipped" prefix
    const result = await createListRecurringRuns()({
      id: created.id,
      excludeNotePrefix: "skipped",
    });

    // Then only the real note comes back — the skip markers are filtered out
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as unknown as RunListContent;
    expect(content.runs.map((run) => run.note)).toEqual(["portfolio A"]);
  });

  it("returns a not-found error result for a well-formed id that matches no task", async () => {
    // Given a well-formed id that matches no recurring task
    const ghostId = new ObjectId().toHexString();

    // When the agent pulls run history for it
    const result = await createListRecurringRuns()({ id: ghostId });

    // Then a readable not-found error comes back — never mistakable for an
    // empty history
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "ERR_NOT_FOUND",
    });
  });

  it("returns an empty history, not an error, for a task that has never finished a run", async () => {
    // Given a task that exists but has never been run
    const created = await createRecurringTask({
      title: "fresh",
      instruction: "first time",
      everyHours: 24,
    });

    // When the agent pulls its run history
    const result = await createListRecurringRuns()({ id: created.id });

    // Then an empty runs list comes back successfully — a first-ever run
    // simply proceeds with no prior context
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as unknown as RunListContent;
    expect(content.runs).toEqual([]);
  });
});
