import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import {
  createCompleteRecurring,
  createFailRecurring,
  createListRecurringDue,
  createStartRecurring,
} from "@/mcp/dispatch-tools";
import { createRecurringTask } from "@/recurring/recurring.service";
import { useTestMongo } from "@/test/use-test-mongo";

interface ListContent {
  tasks: { id: string }[];
}

describe("recurring queue MCP tools", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
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
      code: ErrorCode.AlreadyRunning,
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
});
