import { beforeEach, describe, expect, it } from "vitest";
import { createTask, getTask } from "@/cards/card.service";
import { OriginType } from "@/cards/card.type";
import {
  setWorkspace,
  type WorkspaceDeclaration,
} from "@/cards/card.workspace.service";
import { ErrorCode } from "@/cards/errors";
import { cardsCollection } from "@/db/collections";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";

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
});
