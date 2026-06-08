import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
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
import { createRecurringTask } from "@/recurring/recurring.service";
import { listRecurringRuns } from "@/recurring/recurring-run.service";
import { useTestMongo } from "@/test/use-test-mongo";

describe("listRecurringRuns", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
    await recurringRunsCollection(db).deleteMany({});
  });

  it("returns a task's run history in chronological order (oldest first)", async () => {
    // Given a task that has run twice: first a success, then a failure
    const created = await createRecurringTask({
      title: "twice",
      instruction: "run twice",
      everyHours: 24,
    });
    const db = await getDb();
    const _id = new ObjectId(created.id);

    await startRecurring(created.id);
    await completeRecurring(created.id, { note: "first run ok" });

    // Make it due again, then run a second time and fail
    await recurringTasksCollection(db).updateOne(
      { _id },
      { $set: { nextDueAt: new Date(Date.now() - 60_000) } },
    );
    await startRecurring(created.id);
    await failRecurring(created.id, { error: "second run boom" });

    // When the run history is read
    const runs = await listRecurringRuns(created.id);

    // Then both rows come back oldest-first with their distinguishing content
    expect(runs).toHaveLength(2);
    expect(runs[0].outcome).toBe("success");
    expect(runs[0].note).toBe("first run ok");
    expect(runs[1].outcome).toBe("failure");
    expect(runs[1].error).toBe("second run boom");
  });
});
