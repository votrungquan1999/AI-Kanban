import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { startRecurring } from "@/recurring/recurring.claim.service";
import { createRecurringTask } from "@/recurring/recurring.service";
import {
  RecurringRunState,
  type RecurringTaskDocument,
} from "@/recurring/recurring.type";
import { useTestMongo } from "@/test/use-test-mongo";

/** Inserts a raw recurring task document with the given overrides. */
async function seed(
  overrides: Partial<RecurringTaskDocument>,
): Promise<RecurringTaskDocument> {
  const db = await getDb();
  const past = new Date(Date.now() - 60_000);
  const doc: RecurringTaskDocument = {
    _id: new ObjectId(),
    number: 99,
    title: "seeded",
    instruction: "do something",
    everyHours: 24,
    enabled: true,
    runState: RecurringRunState.Idle,
    nextDueAt: past,
    lastRunAt: null,
    lastOutcome: null,
    createdAt: past,
    updatedAt: past,
    ...overrides,
  };
  await recurringTasksCollection(db).insertOne(doc);
  return doc;
}

describe("startRecurring", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
  });

  it("atomically claims a due task, flipping it to running and stamping lastRunAt", async () => {
    // Given a freshly created (enabled, idle, immediately-due) task
    const created = await createRecurringTask({
      title: "claim me",
      instruction: "run me",
      everyHours: 24,
    });

    // When it is claimed
    const claimed = await startRecurring(created.id);

    // Then it comes back running with lastRunAt stamped
    expect(claimed.runState).toBe("running");
    expect(claimed.lastRunAt).not.toBeNull();

    // And the stored document reflects the running state
    const db = await getDb();
    const raw = await recurringTasksCollection(db).findOne({
      _id: new ObjectId(created.id),
    });
    expect(raw?.runState).toBe("running");
    expect(raw?.lastRunAt).toBeInstanceOf(Date);
  });

  it("lets exactly one of many concurrent claims win; the losers are rejected with AlreadyRunning", async () => {
    // Given one due task
    const created = await createRecurringTask({
      title: "contended",
      instruction: "run me",
      everyHours: 24,
    });

    // When 25 claims race for it
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => startRecurring(created.id)),
    );

    // Then exactly one wins and the other 24 are rejected with AlreadyRunning
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(24);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: ErrorCode.AlreadyRunning,
      });
    }
  });

  it("rejects a disabled task and a not-yet-due task with NotDue", async () => {
    // Given a disabled (but otherwise idle/past-due) task and a not-yet-due task
    const disabled = await seed({ enabled: false });
    const future = await seed({
      nextDueAt: new Date(Date.now() + 3_600_000),
    });

    // When each is claimed, Then both are rejected with NotDue
    await expect(
      startRecurring(disabled._id.toHexString()),
    ).rejects.toMatchObject({ code: ErrorCode.NotDue });
    await expect(
      startRecurring(future._id.toHexString()),
    ).rejects.toMatchObject({ code: ErrorCode.NotDue });
  });

  it("rejects a claim for an unknown id with NotFound", async () => {
    // Given an id that matches no task
    // When it is claimed, Then it is rejected with NotFound
    await expect(
      startRecurring(new ObjectId().toHexString()),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it("rejects a claim for a failed (parked) task with AlreadyRunning, not NotDue", async () => {
    // Given a failed task that is otherwise past-due and enabled
    const failed = await seed({ runState: RecurringRunState.Failed });

    // When it is claimed, Then it is rejected as not-idle (AlreadyRunning),
    // distinguishing a parked-failed task from a disabled/not-yet-due one
    await expect(
      startRecurring(failed._id.toHexString()),
    ).rejects.toMatchObject({ code: ErrorCode.AlreadyRunning });
  });
});
