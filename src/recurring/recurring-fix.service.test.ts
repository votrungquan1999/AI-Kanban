import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@/cards/errors";
import { recurringTasksCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { resetToDue, setFixNote } from "@/recurring/recurring.fix.service";
import { listRecurringDue } from "@/recurring/recurring.service";
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
    runState: RecurringRunState.Failed,
    nextDueAt: past,
    lastRunAt: past,
    lastOutcome: null,
    failureReason: "it broke",
    createdAt: past,
    updatedAt: past,
    ...overrides,
  };
  await recurringTasksCollection(db).insertOne(doc, { ignoreUndefined: true });
  return doc;
}

describe("recurring fix loop", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await recurringTasksCollection(db).deleteMany({});
  });

  it("records a fix note on a failed task", async () => {
    // Given a failed task
    const failed = await seed({});

    // When the operator records a fix note
    const updated = await setFixNote(failed._id.toHexString(), {
      note: "rotate the API token, then reset",
    });

    // Then the note is stored and the task stays failed
    expect(updated.fixNote).toBe("rotate the API token, then reset");
    expect(updated.runState).toBe("failed");
  });

  it("rejects a fix note on a non-failed task", async () => {
    // Given an idle task
    const idle = await seed({ runState: RecurringRunState.Idle });

    // When recording a fix note, Then it is rejected as an invalid transition
    await expect(
      setFixNote(idle._id.toHexString(), { note: "nope" }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidTransition });
  });

  it("resets a failed task back to due: idle, immediately due, failureReason cleared, fixNote kept", async () => {
    // Given a failed task with a fix note already recorded
    const failed = await seed({ fixNote: "fixed the token" });

    // When the operator resets it to due
    const reset = await resetToDue(failed._id.toHexString());

    // Then it is idle, due again, failureReason cleared, fixNote preserved
    expect(reset.runState).toBe("idle");
    expect(reset.failureReason).toBeUndefined();
    expect(reset.fixNote).toBe("fixed the token");

    // And the routine now lists it as due again
    const due = await listRecurringDue();
    expect(due.find((t) => t.id === failed._id.toHexString())).toBeDefined();
  });
});
