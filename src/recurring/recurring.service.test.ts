import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { recurringTasksCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import {
  createRecurringTask,
  getRecurringTask,
} from "@/recurring/recurring.service";
import { useTestMongo } from "@/test/use-test-mongo";

describe("createRecurringTask + getRecurringTask", () => {
  useTestMongo();

  it("creates a task with a monotonic number, idle state, and an immediately-due first due time, then reads it back", async () => {
    // Given a valid repo-less recurring task input
    // When it is created
    const created = await createRecurringTask({
      title: "Summarize inbox",
      instruction: "Summarize my inbox and post the digest to Slack",
      everyHours: 24,
    });

    // Then it comes back as a client task: number 1, enabled, idle, no run yet,
    // a hex id, and nextDueAt equal to createdAt (immediately due on the next wake)
    expect(created.number).toBe(1);
    expect(created.title).toBe("Summarize inbox");
    expect(created.instruction).toBe(
      "Summarize my inbox and post the digest to Slack",
    );
    expect(created.everyHours).toBe(24);
    expect(created.enabled).toBe(true);
    expect(created.runState).toBe("idle");
    expect(created.lastRunAt).toBeNull();
    expect(created.lastOutcome).toBeNull();
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect(created.nextDueAt).toBe(created.createdAt);

    // And reading it back by id returns the identical client object
    const fetched = await getRecurringTask(created.id);
    expect(fetched).toEqual(created);

    // And the stored document keeps native BSON types (real ObjectId + Date)
    const db = await getDb();
    const raw = await recurringTasksCollection(db).findOne({
      _id: new ObjectId(created.id),
    });
    expect(raw?.number).toBe(1);
    expect(raw?.runState).toBe("idle");
    expect(raw?.createdAt).toBeInstanceOf(Date);
    expect(raw?.nextDueAt).toBeInstanceOf(Date);
  });
});
