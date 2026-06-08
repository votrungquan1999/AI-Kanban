import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@/cards/errors";
import {
  recurringRunsCollection,
  recurringTasksCollection,
} from "@/db/collections";
import { getDb } from "@/db/mongo";
import { startRecurring } from "@/recurring/recurring.claim.service";
import {
  completeRecurring,
  failRecurring,
} from "@/recurring/recurring.lifecycle.service";
import {
  createRecurringTask,
  listRecurringDue,
} from "@/recurring/recurring.service";
import { useTestMongo } from "@/test/use-test-mongo";

describe("completeRecurring", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
    await recurringRunsCollection(db).deleteMany({});
  });

  it("marks a running task idle, rolls next due forward, records success, and appends a success run-history row", async () => {
    // Given a created task that has been claimed (running, lastRunAt stamped)
    const created = await createRecurringTask({
      title: "summarize",
      instruction: "summarize and post",
      everyHours: 24,
    });
    const claimed = await startRecurring(created.id);

    // When it completes with a note
    const beforeComplete = Date.now();
    const completed = await completeRecurring(created.id, { note: "all good" });
    const afterComplete = Date.now();

    // Then the task is idle again, outcome success, and the due time rolled
    // forward by the task's 24h interval measured from the completion time
    expect(completed.runState).toBe("idle");
    expect(completed.lastOutcome).toBe("success");
    const TWENTY_FOUR_HOURS_MS = 24 * 3_600_000;
    expect(new Date(completed.nextDueAt).getTime()).toBeGreaterThanOrEqual(
      beforeComplete + TWENTY_FOUR_HOURS_MS,
    );
    expect(new Date(completed.nextDueAt).getTime()).toBeLessThanOrEqual(
      afterComplete + TWENTY_FOUR_HOURS_MS,
    );

    // And exactly one success run-history row was appended, carrying the note
    // and the startedAt = the claim's lastRunAt
    const db = await getDb();
    const runs = await recurringRunsCollection(db)
      .find({ recurringId: new ObjectId(created.id) })
      .toArray();
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("success");
    expect(runs[0].note).toBe("all good");
    expect(runs[0].startedAt.toISOString()).toBe(claimed.lastRunAt);
    expect(runs[0].finishedAt).toBeInstanceOf(Date);
  });

  it("marks a running task failed with a reason, records failure, appends a failure run-history row, and drops it from the due list", async () => {
    // Given a created task that has been claimed (running)
    const created = await createRecurringTask({
      title: "flaky job",
      instruction: "do the flaky thing",
      everyHours: 24,
    });
    await startRecurring(created.id);

    // When it fails with a reason
    const failed = await failRecurring(created.id, {
      error: "boom: timed out",
    });

    // Then the task is failed, outcome failure, with the reason stored
    expect(failed.runState).toBe("failed");
    expect(failed.lastOutcome).toBe("failure");
    expect(failed.failureReason).toBe("boom: timed out");

    // And it is no longer due (the routine skips failed tasks)
    const due = await listRecurringDue();
    expect(due.find((t) => t.id === created.id)).toBeUndefined();

    // And exactly one failure run-history row was appended carrying the error
    const db = await getDb();
    const runs = await recurringRunsCollection(db)
      .find({ recurringId: new ObjectId(created.id) })
      .toArray();
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("failure");
    expect(runs[0].error).toBe("boom: timed out");
  });

  it("rejects completing or failing a non-running task: InvalidTransition when idle, NotFound when missing", async () => {
    // Given a freshly created (idle, never claimed) task
    const idle = await createRecurringTask({
      title: "idle one",
      instruction: "do it",
      everyHours: 24,
    });

    // When completing/failing it without claiming, Then InvalidTransition (not running)
    await expect(completeRecurring(idle.id)).rejects.toMatchObject({
      code: ErrorCode.InvalidTransition,
    });
    await expect(failRecurring(idle.id, { error: "x" })).rejects.toMatchObject({
      code: ErrorCode.InvalidTransition,
    });

    // And for an unknown id, Then NotFound (distinct from InvalidTransition)
    const missing = new ObjectId().toHexString();
    await expect(completeRecurring(missing)).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
    await expect(failRecurring(missing, { error: "x" })).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
});
