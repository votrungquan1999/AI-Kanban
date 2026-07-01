import { describe, expect, it } from "vitest";
import { Status } from "@/cards/card.type";
import { Caller, legalFromStatuses } from "@/cards/transition-policy";

describe("legalFromStatuses — agent", () => {
  it("returns exactly the legal source statuses for each target", () => {
    // Given the agent's five legal edges, When asked per target,
    // Then only the matching source statuses are returned (order-independent).
    expect(new Set(legalFromStatuses(Caller.Agent, Status.NeedReview))).toEqual(
      new Set([Status.InProgress]),
    );
    expect(new Set(legalFromStatuses(Caller.Agent, Status.Done))).toEqual(
      new Set([Status.InProgress, Status.NeedReview]),
    );
    expect(new Set(legalFromStatuses(Caller.Agent, Status.InProgress))).toEqual(
      new Set([Status.NeedReview, Status.Staled]),
    );
    expect(legalFromStatuses(Caller.Agent, Status.Todo)).toEqual([]);
  });
});

describe("legalFromStatuses — UI", () => {
  it("permits any source for any target (the human override)", () => {
    // Given the UI caller, every target accepts every status as a source.
    const allStatuses = Object.values(Status);
    for (const to of allStatuses) {
      expect(new Set(legalFromStatuses(Caller.Ui, to))).toEqual(
        new Set(allStatuses),
      );
    }
  });
});

describe("legalFromStatuses — scheduler", () => {
  it("grants no agent-exposed edge in this slice", () => {
    // Given the scheduler caller, no target is reachable yet.
    for (const to of Object.values(Status)) {
      expect(legalFromStatuses(Caller.Scheduler, to)).toEqual([]);
    }
  });
});
