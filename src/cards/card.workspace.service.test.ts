import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createTask, getTask } from "@/cards/card.service";
import { reconcileStaledCards } from "@/cards/card.staled.service";
import { OriginType, Status } from "@/cards/card.type";
import {
  setWorkspace,
  type WorkspaceDeclaration,
} from "@/cards/card.workspace.service";
import { listCardEvents } from "@/cards/card-event.service";
import { CardEventKind } from "@/cards/card-event.type";
import { ErrorCode } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Create an in-progress card and park it in the Staled lane via reconcile. */
async function createStaledCard(title: string): Promise<string> {
  const card = await createCard({ title, tags: [], sessionId: "session-1" });
  const db = await getDb();
  await cardsCollection(db).updateOne(
    { _id: new ObjectId(card.id) },
    { $set: { updatedAt: new Date(Date.now() - THREE_HOURS_MS - 1000) } },
  );
  await reconcileStaledCards();
  return card.id;
}

describe("setWorkspace", () => {
  useTestMongo();

  beforeEach(async () => {
    const db = await getDb();
    await cardsCollection(db).deleteMany({});
  });

  it("replaces the card's workspace state with the declared path and repos", async () => {
    // Given a card with empty workspace bookkeeping
    const created = await createTask({
      title: "declare workspace",
      origin: { type: OriginType.Manual },
    });

    // When a workspace path and a set of repos are declared for it
    const declaration: WorkspaceDeclaration = {
      workspacePath: "workspaces/card-1",
      repos: [
        {
          repo: "repo-a",
          branch: "aikanban/card-1",
          worktreePath: "workspaces/card-1/repo-a",
        },
      ],
    };
    await setWorkspace(created.id, declaration);

    // Then reading the card back shows exactly the declared path and repos
    const fetched = await getTask(created.id);
    expect(fetched.workspacePath).toBe("workspaces/card-1");
    expect(fetched.repos).toEqual(declaration.repos);
  });

  it("is idempotent when the same workspace state is declared twice", async () => {
    // Given a card whose workspace was already declared with a given set
    const created = await createTask({
      title: "re-declare workspace",
      origin: { type: OriginType.Manual },
    });
    const declaration: WorkspaceDeclaration = {
      workspacePath: "workspaces/card-1",
      repos: [
        {
          repo: "repo-a",
          branch: "aikanban/card-1",
          worktreePath: "workspaces/card-1/repo-a",
        },
      ],
    };
    await setWorkspace(created.id, declaration);

    // When the exact same state is declared again
    await setWorkspace(created.id, declaration);

    // Then the card is unchanged — the same single set of repos, no duplicates
    const fetched = await getTask(created.id);
    expect(fetched.workspacePath).toBe("workspaces/card-1");
    expect(fetched.repos).toEqual(declaration.repos);
    expect(fetched.repos).toHaveLength(1);
  });

  it("rejects a malformed declaration and leaves the stored card untouched", async () => {
    // Given a card and a declaration whose repo entry is missing required parts
    const created = await createTask({
      title: "bad declaration",
      origin: { type: OriginType.Manual },
    });
    const malformed = {
      workspacePath: "workspaces/card-1",
      repos: [{ repo: "repo-a" }],
    } as unknown as WorkspaceDeclaration;

    // When the malformed state is declared, Then it is rejected as a validation error
    await expect(setWorkspace(created.id, malformed)).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });

    // And the card's stored workspace bookkeeping is unchanged (still empty)
    const fetched = await getTask(created.id);
    expect(fetched.workspacePath).toBeNull();
    expect(fetched.repos).toEqual([]);
  });

  it("revives a staled card back to in_progress when a workspace is declared", async () => {
    // Given a card parked in the Staled lane
    const cardId = await createStaledCard("Parked work");

    // When the agent declares its workspace
    const updated = await setWorkspace(cardId, {
      workspacePath: "workspaces/card-1",
      repos: [],
    });

    // Then the card is revived and a system revive was audited
    expect(updated.status).toBe(Status.InProgress);
    expect((await getTask(cardId)).status).toBe(Status.InProgress);
    const events = await listCardEvents(cardId);
    const revives = events.filter(
      (event) =>
        event.kind === CardEventKind.StatusTransition &&
        event.caller === Caller.System &&
        event.from === Status.Staled &&
        event.to === Status.InProgress,
    );
    expect(revives).toHaveLength(1);
  });
});
