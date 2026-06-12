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
    workspacePath: null,
    repos: [],
  };
}

describe("groupIntoColumns", () => {
  it("produces the five columns in order with Blocked between In Progress and Need Review", () => {
    const blockedCard = makeCard("b1", Status.Blocked);

    const columns = groupIntoColumns([blockedCard]);

    // The board's column order, left to right
    expect(columns.map((column) => column.status)).toEqual([
      Status.Todo,
      Status.InProgress,
      Status.Blocked,
      Status.NeedReview,
      Status.Done,
    ]);
    // and the blocked card lands under the Blocked column
    const blockedColumn = columns.find(
      (column) => column.status === Status.Blocked,
    );
    expect(blockedColumn?.cards).toEqual([blockedCard]);
  });
});
