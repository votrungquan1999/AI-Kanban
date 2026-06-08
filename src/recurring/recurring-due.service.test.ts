import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { recurringTasksCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import {
  createRecurringTask,
  listRecurringDue,
} from "@/recurring/recurring.service";
import {
  RecurringRunState,
  type RecurringTaskDocument,
} from "@/recurring/recurring.type";
import { useTestMongo } from "@/test/use-test-mongo";

/** Inserts a raw recurring task document with the given overrides. */
async function seed(overrides: Partial<RecurringTaskDocument>): Promise<void> {
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
}

describe("listRecurringDue", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
  });

  it("returns only enabled, idle, due tasks — excluding disabled, running, failed, and not-yet-due", async () => {
    // Given a freshly created (enabled, idle, immediately-due) task
    const due = await createRecurringTask({
      title: "due now",
      instruction: "run me",
      everyHours: 24,
    });

    // And one of each excluded kind
    await seed({ enabled: false }); // disabled
    await seed({ runState: RecurringRunState.Running }); // running
    await seed({ runState: RecurringRunState.Failed }); // failed
    await seed({ nextDueAt: new Date(Date.now() + 3_600_000) }); // not yet due

    // When listing due tasks
    const result = await listRecurringDue();

    // Then exactly the one due task comes back
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(due.id);
    expect(result[0].runState).toBe("idle");
  });
});
