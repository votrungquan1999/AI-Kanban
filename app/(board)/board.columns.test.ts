import { describe, expect, it } from "vitest";
import { type Card, OriginType, Status } from "@/cards/card.type";
import { groupIntoColumns } from "./board.columns";

/** Builds a minimal client card in the given status for grouping tests. */
function makeCard(id: string, status: Status): Card {
  return {
    id,
    number: 1,
    title: `card ${id}`,
    status,
    priority: 0,
    origin: { type: OriginType.Manual },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pickedAt: null,
    finishedAt: null,
    blockedUntil: null,
    blockInterval: null,
    workspacePath: null,
    repos: [],
    tags: [],
    sessionId: null,
    progress: [],
  };
}

describe("groupIntoColumns", () => {
  it("produces six columns in order: Todo · In Progress · Staled · Blocked · Need Review · Done", () => {
    const staledCard = makeCard("s1", Status.Staled);

    const columns = groupIntoColumns([staledCard]);

    // The board's column order, left to right — Staled sits right after In Progress
    expect(columns.map((column) => column.status)).toEqual([
      Status.Todo,
      Status.InProgress,
      Status.Staled,
      Status.Blocked,
      Status.NeedReview,
      Status.Done,
    ]);
    // and the staled card lands under the Staled column
    const staledColumn = columns.find(
      (column) => column.status === Status.Staled,
    );
    expect(staledColumn?.cards).toEqual([staledCard]);
  });
});
