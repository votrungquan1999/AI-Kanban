import { describe, expect, it } from "vitest";
import {
  appendDecision,
  markDecisionOutdated,
} from "@/cards/card.decision.service";
import { appendProgress } from "@/cards/card.progress.service";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { CardView, OriginType, Status } from "@/cards/card.type";
import { AppError, ErrorCode } from "@/cards/errors";
import {
  appErrorToToolResult,
  createGetMyTask,
  createSetMyStatus,
} from "@/mcp/tools";
import { useTestMongo } from "@/test/use-test-mongo";

describe("appErrorToToolResult", () => {
  it("maps an AppError to an error result carrying the code in text and structuredContent", () => {
    // Given a domain error
    const result = appErrorToToolResult(
      new AppError(ErrorCode.InvalidTransition, "illegal move"),
    );

    // Then it is flagged as an error and the ERR_* code is readable both ways
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: ErrorCode.InvalidTransition,
      message: "illegal move",
    });
    expect(result.content).toEqual([
      { type: "text", text: "ERR_INVALID_TRANSITION: illegal move" },
    ]);
  });
});

describe("get_my_task handler", () => {
  useTestMongo();

  it("returns the bound card in full as structured content when asked", async () => {
    // Given a card the handler is bound to
    const created = await createTask({
      title: "bound",
      origin: { type: OriginType.Manual },
    });

    // When the agent reads its task and asks for the whole card
    const result = await createGetMyTask(created.id)({ view: CardView.Full });

    // Then the bound card comes back as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      title: "bound",
      status: Status.Todo,
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(created),
    });
  });

  it("returns a resume view by default, matching the generic card read", async () => {
    // Given the session's card carrying a superseded decision and two notes
    const created = await createTask({
      title: "bound and busy",
      origin: { type: OriginType.Manual },
    });
    await appendDecision(created.id, "first choice", "why the first won");
    await appendDecision(created.id, "second choice");
    await markDecisionOutdated(created.id, 0, 1);
    await appendProgress(created.id, "an early note");
    await appendProgress(created.id, "the latest note");

    // When the session reads its own task without asking for a view
    const result = await createGetMyTask(created.id)();

    // Then it is trimmed the same way the generic read trims — a card-bound
    // session resuming after a compact has the same need as any other
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      title: "bound and busy",
      latestProgress: { note: "the latest note" },
      omitted: { outdatedDecisions: 1, earlierProgress: 1 },
    });
    expect(
      (result.structuredContent as { decisions: unknown[] }).decisions,
    ).toEqual([{ index: 1, decision: "second choice" }]);
  });
});

describe("set_my_status handler", () => {
  useTestMongo();

  it("moves the bound card along a legal edge and returns it", async () => {
    // Given a card the UI has advanced to in_progress (a legal agent source)
    const created = await createTask({
      title: "agent moves me",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(created.id, Status.InProgress);

    // When the agent sets its status to need_review (legal edge)
    const result = await createSetMyStatus(created.id)({
      status: Status.NeedReview,
    });

    // Then the move succeeds and the updated card comes back
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.NeedReview,
    });
  });

  it("moves the bound card along a once-illegal agent edge now that any->any parity applies", async () => {
    // Given a card still in todo (previously not a legal agent source for done)
    const created = await createTask({
      title: "agent jumps directly to done",
      origin: { type: OriginType.Manual },
    });

    // When the agent jumps straight todo -> done (any->any parity, Step 1)
    const result = await createSetMyStatus(created.id)({ status: Status.Done });

    // Then the move succeeds and the bound card lands at done
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.Done,
    });
  });
});
