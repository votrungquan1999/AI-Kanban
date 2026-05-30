import { describe, expect, it } from "vitest";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
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

  it("returns the bound card as structured content", async () => {
    // Given a card the handler is bound to
    const created = await createTask({
      title: "bound",
      origin: { type: OriginType.Manual },
    });

    // When the agent reads its task
    const result = await createGetMyTask(created.id)();

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

  it("returns an error result when the edge is illegal", async () => {
    // Given a card still in todo (not a legal agent source for done)
    const created = await createTask({
      title: "agent overreaches",
      origin: { type: OriginType.Manual },
    });

    // When the agent attempts the illegal todo -> done edge
    const result = await createSetMyStatus(created.id)({ status: Status.Done });

    // Then it comes back as a readable error carrying the ERR_* code
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.InvalidTransition,
    });
  });
});
