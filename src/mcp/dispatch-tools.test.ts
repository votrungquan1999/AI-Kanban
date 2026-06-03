import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createTask, updateTaskStatus } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind, EventOutcome } from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import {
  createClaimCard,
  createGetCardContext,
  createSetStatus,
  createSetWorkspace,
} from "@/mcp/dispatch-tools";
import { useTestMongo } from "@/test/use-test-mongo";

describe("claim_card handler", () => {
  useTestMongo();

  it("claims a todo card by id and returns it as success, now in progress", async () => {
    // Given a card waiting in Todo
    const created = await createTask({
      title: "claim via tool",
      origin: { type: OriginType.Manual },
    });

    // When the claim tool is invoked with the card's id
    const result = await createClaimCard()({ id: created.id });

    // Then the claimed card comes back as a success result, now in progress
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.InProgress,
    });
  });

  it("reports a failed claim as a readable error result without throwing", async () => {
    // Given a card that has already been claimed
    const created = await createTask({
      title: "already taken",
      origin: { type: OriginType.Manual },
    });
    const claim = createClaimCard();
    await claim({ id: created.id });

    // When the same card is claimed again
    const second = await claim({ id: created.id });

    // Then a readable failure result comes back (not a throw)
    expect(second.isError).toBe(true);
    expect(second.content[0]).toMatchObject({ type: "text" });

    // And an unknown id is reported the same readable way (not a throw)
    const unknown = await claim({ id: new ObjectId().toHexString() });
    expect(unknown.isError).toBe(true);
  });
});

describe("get_card_context handler", () => {
  useTestMongo();

  it("returns a card's task context by id", async () => {
    // Given an existing card
    const created = await createTask({
      title: "read context",
      origin: { type: OriginType.Manual },
    });

    // When the context tool is invoked with that card's id
    const result = await createGetCardContext()({ id: created.id });

    // Then the card's task context comes back as success structured content
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      title: "read context",
      status: Status.Todo,
    });
  });
});

describe("set_status handler", () => {
  useTestMongo();

  it("moves a card to a legal next status by id and records it in the audit log", async () => {
    // Given a card that is in progress (a legal agent source)
    const created = await createTask({
      title: "advance me",
      origin: { type: OriginType.Manual },
    });
    await updateTaskStatus(created.id, Status.InProgress);

    // When the status tool moves it to need_review (a legal agent edge)
    const result = await createSetStatus()({
      id: created.id,
      status: Status.NeedReview,
    });

    // Then the updated card comes back at the new status
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      status: Status.NeedReview,
    });

    // And the change is recorded in the audit log
    const events = await listCardEvents(created.id);
    const moved = events.find(
      (e) =>
        e.kind === CardEventKind.StatusTransition &&
        e.to === Status.NeedReview &&
        e.outcome === EventOutcome.Success,
    );
    expect(moved).toBeDefined();
  });

  it("refuses an illegal status change as a readable error, leaving the card unchanged", async () => {
    // Given a card still in todo (not a legal agent source for done)
    const created = await createTask({
      title: "illegal move",
      origin: { type: OriginType.Manual },
    });

    // When the status tool attempts the illegal todo -> done edge
    const result = await createSetStatus()({
      id: created.id,
      status: Status.Done,
    });

    // Then it comes back as a readable error carrying the ERR_* code
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: ErrorCode.InvalidTransition,
    });

    // And the card's status is unchanged
    const after = await createGetCardContext()({ id: created.id });
    expect(after.structuredContent).toMatchObject({ status: Status.Todo });
  });
});

describe("set_workspace handler", () => {
  useTestMongo();

  it("declares a card's workspace state by id and reflects it on the card", async () => {
    // Given an existing card
    const created = await createTask({
      title: "declare via tool",
      origin: { type: OriginType.Manual },
    });

    // When the workspace tool is invoked with a declaration
    const repos = [
      {
        repo: "repo-a",
        branch: "aikanban/card-1",
        worktreePath: "workspaces/card-1/repo-a",
      },
    ];
    const result = await createSetWorkspace()({
      id: created.id,
      workspacePath: "workspaces/card-1",
      repos,
    });

    // Then the tool succeeds and the card reflects the declared workspace state
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      id: created.id,
      workspacePath: "workspaces/card-1",
      repos,
    });
  });
});
