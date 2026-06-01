import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { claimCard } from "@/cards/card.claim.service";
import { getTask, updateTaskStatus } from "@/cards/card.service";
import type { RepoEntry, Status } from "@/cards/card.type";
import { setWorkspace } from "@/cards/card.workspace.service";
import { AppError } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import { appErrorToToolResult, toCardResult } from "@/mcp/tools";

/**
 * Builds a readable failure result for a claim that returned nothing. A missing
 * card and an already-claimed card are deliberately indistinguishable (both
 * lose the atomic `findOneAndUpdate`), so they map to one generic message.
 * @param id - The card id that could not be claimed.
 * @returns A tool result flagged as an error.
 */
function claimUnavailableResult(id: string): CallToolResult {
  const message = `card ${id} is not available to claim (already claimed or not found)`;
  return {
    isError: true,
    structuredContent: { message },
    content: [{ type: "text", text: message }],
  };
}

/**
 * Builds the generic `claim_card` dispatch handler. Unlike the card-scoped
 * tools, it takes the card id as a runtime argument so a generic session can
 * claim any card. A successful claim returns the now-in-progress card; a card
 * that cannot be claimed returns a readable failure result rather than throwing;
 * an unexpected domain error is surfaced via {@link appErrorToToolResult}.
 * @returns A handler that claims the card named by its `id` argument.
 */
export function createClaimCard(): (args: {
  id: string;
}) => Promise<CallToolResult> {
  return async ({ id }) => {
    try {
      const card = await claimCard(id);
      if (!card) {
        return claimUnavailableResult(id);
      }
      return toCardResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `get_card_context` handler, reading any card's task
 * context by its `id` argument. A domain error (e.g. unknown id) is returned as
 * a readable error result; unexpected throws propagate.
 * @returns A handler returning the card named by its `id` argument.
 */
export function createGetCardContext(): (args: {
  id: string;
}) => Promise<CallToolResult> {
  return async ({ id }) => {
    try {
      return toCardResult(await getTask(id));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `set_status` handler, moving any card to a new status by
 * its `id` argument as the agent caller. An illegal transition (or missing card)
 * is returned as a readable error result rather than thrown; the underlying
 * `updateTaskStatus` enforces the policy and emits the audit row.
 * @returns A handler that applies the requested status to the card.
 */
export function createSetStatus(): (args: {
  id: string;
  status: Status;
}) => Promise<CallToolResult> {
  return async ({ id, status }) => {
    try {
      const card = await updateTaskStatus(id, status, { caller: Caller.Agent });
      return toCardResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `set_workspace` handler, declaring any card's full
 * workspace state by its `id` argument (replaces prior state). A malformed
 * declaration or missing card is returned as a readable error result;
 * `setWorkspace` owns the validation and persistence.
 * @returns A handler that records the declared workspace state.
 */
export function createSetWorkspace(): (args: {
  id: string;
  workspacePath: string;
  repos: RepoEntry[];
}) => Promise<CallToolResult> {
  return async ({ id, workspacePath, repos }) => {
    try {
      const card = await setWorkspace(id, { workspacePath, repos });
      return toCardResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}
