import { describe, expect, it } from "vitest";
import { Status } from "@/cards/card.type";
import { Caller, legalFromStatuses } from "@/cards/transition-policy";

describe("legalFromStatuses — agent", () => {
  it("permits any source for any target (parity with the human UI)", () => {
    // Given the agent caller, every target accepts every status as a source.
    const allStatuses = Object.values(Status);
    for (const to of allStatuses) {
      expect(new Set(legalFromStatuses(Caller.Agent, to))).toEqual(
        new Set(allStatuses),
      );
    }
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
