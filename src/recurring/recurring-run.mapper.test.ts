import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { RecurringOutcome } from "@/recurring/recurring.type";
import { toClientRecurringRun } from "@/recurring/recurring-run.mapper";
import type { RecurringRunDocument } from "@/recurring/recurring-run.type";

describe("toClientRecurringRun", () => {
  it("maps a run document to hex ids and ISO timestamps", () => {
    const _id = new ObjectId("0123456789abcdef01234567");
    const recurringId = new ObjectId("76543210fedcba9876543210");
    const doc: RecurringRunDocument = {
      _id,
      recurringId,
      at: new Date("2026-01-02T03:04:05.000Z"),
      startedAt: new Date("2026-01-02T03:00:00.000Z"),
      finishedAt: new Date("2026-01-02T03:04:05.000Z"),
      outcome: RecurringOutcome.Success,
      note: "all good",
    };

    expect(toClientRecurringRun(doc)).toEqual({
      id: "0123456789abcdef01234567",
      recurringId: "76543210fedcba9876543210",
      at: "2026-01-02T03:04:05.000Z",
      startedAt: "2026-01-02T03:00:00.000Z",
      finishedAt: "2026-01-02T03:04:05.000Z",
      outcome: RecurringOutcome.Success,
      note: "all good",
      error: undefined,
    });
  });

  it("maps a failure run, carrying the error and leaving note absent", () => {
    const doc: RecurringRunDocument = {
      _id: new ObjectId("0123456789abcdef01234567"),
      recurringId: new ObjectId("76543210fedcba9876543210"),
      at: new Date("2026-01-02T03:04:05.000Z"),
      startedAt: new Date("2026-01-02T03:00:00.000Z"),
      finishedAt: new Date("2026-01-02T03:04:05.000Z"),
      outcome: RecurringOutcome.Failure,
      error: "boom: timeout",
    };

    expect(toClientRecurringRun(doc)).toEqual({
      id: "0123456789abcdef01234567",
      recurringId: "76543210fedcba9876543210",
      at: "2026-01-02T03:04:05.000Z",
      startedAt: "2026-01-02T03:00:00.000Z",
      finishedAt: "2026-01-02T03:04:05.000Z",
      outcome: RecurringOutcome.Failure,
      note: undefined,
      error: "boom: timeout",
    });
  });
});
