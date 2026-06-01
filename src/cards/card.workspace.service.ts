import { ObjectId } from "mongodb";
import { z } from "zod";
import { cardDocumentSchema } from "@/cards/card.document.schema";
import { toClientCard } from "@/cards/card.mapper";
import type { Card } from "@/cards/card.type";
import { AppError, ErrorCode } from "@/cards/errors";
import { cardsCollection } from "@/db/collections";
import { findOneAndUpdateZ } from "@/db/find-z";
import { getDb } from "@/db/mongo";

/**
 * Validates one declared repo entry. Distinct from the read-path
 * `repoEntrySchema` in `card.document.schema.ts`: this is the *input* contract
 * for what an agent declares, with non-empty strings.
 */
const repoEntryInputSchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
});

/** Validates the full workspace declaration an agent sends (PUT input). */
export const workspaceDeclarationSchema = z.object({
  workspacePath: z.string().min(1),
  repos: z.array(repoEntryInputSchema),
});

/** The full workspace state an agent declares for a card (PUT semantics). */
export type WorkspaceDeclaration = z.input<typeof workspaceDeclarationSchema>;

/**
 * Declares a card's full workspace state, replacing any prior `workspacePath`
 * and `repos` (PUT semantics, not append) — so re-declaring the same state is
 * idempotent. The declaration is validated before the write; a malformed entry
 * throws {@link ErrorCode.Validation} and leaves the stored card untouched. An
 * unknown id throws {@link ErrorCode.NotFound}. No audit event is emitted.
 * @param id - The card's hex id.
 * @param declaration - The full workspace state to record.
 * @returns The updated client card.
 */
export async function setWorkspace(
  id: string,
  declaration: WorkspaceDeclaration,
): Promise<Card> {
  const parsed = workspaceDeclarationSchema.safeParse(declaration);
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.Validation,
      `invalid workspace declaration: ${parsed.error.message}`,
    );
  }

  const db = await getDb();
  const updated = await findOneAndUpdateZ(
    cardsCollection(db),
    { _id: new ObjectId(id) },
    {
      $set: {
        workspacePath: parsed.data.workspacePath,
        repos: parsed.data.repos,
        updatedAt: new Date(),
      },
    },
    cardDocumentSchema,
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new AppError(ErrorCode.NotFound, `card ${id} not found`);
  }

  return toClientCard(updated);
}
