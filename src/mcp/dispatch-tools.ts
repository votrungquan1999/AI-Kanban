import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { claimCard } from "@/cards/card.claim.service";
import { updateTask } from "@/cards/card.edit.service";
import { appendProgress } from "@/cards/card.progress.service";
import type { UpdateTaskInput } from "@/cards/card.schema";
import {
  createCard,
  getTask,
  listCards,
  updateTaskStatus,
} from "@/cards/card.service";
import type { RepoEntry, Status } from "@/cards/card.type";
import { setWorkspace } from "@/cards/card.workspace.service";
import { AppError } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import {
  appErrorToToolResult,
  toCardListResult,
  toCardResult,
  toRecurringListResult,
  toRecurringResult,
  toRecurringRunListResult,
} from "@/mcp/tools";
import { startRecurring } from "@/recurring/recurring.claim.service";
import {
  completeRecurring,
  failRecurring,
} from "@/recurring/recurring.lifecycle.service";
import { listRecurringDue } from "@/recurring/recurring.service";
import { toClientRecurringRun } from "@/recurring/recurring-run.mapper";
import { listLatestRecurringRuns } from "@/recurring/recurring-run.service";

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
 * Builds the generic `create_card` handler: a session starts tracking its work
 * as a card that lands directly in_progress, carrying the session's labels and
 * handle. A domain error (e.g. invalid input) is returned as a readable error
 * result; unexpected throws propagate.
 * @returns A handler that creates the session-tracked card from its arguments.
 */
export function createCreateCard(): (args: {
  title: string;
  description?: string;
  tags: string[];
  sessionId?: string;
  nextAction?: string;
}) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return toCardResult(await createCard(args));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the `list_cards` handler: surveys the board as a compact per-card
 * summary. `status` narrows to exactly those statuses (overrides the default
 * hide-done/archived); `tags` narrows to cards with any named tag; `text` is
 * a keyword match on title/description; each falls through to "not applied"
 * when empty/whitespace/omitted. `limit` caps the count (default ~50, capped
 * at 200 — see {@link listCards}).
 * @returns A handler returning the lean cards under a `cards` key.
 */
export function createListCards(): (args: {
  status?: Status[];
  tags?: string[];
  limit?: number;
  text?: string;
}) => Promise<CallToolResult> {
  return async ({ status, tags, limit, text }) => {
    return toCardListResult(await listCards({ status, tags, limit, text }));
  };
}

/**
 * Builds the generic `update_card` handler: edits a card's core fields by its
 * `id` argument as the agent caller, so the audit trail distinguishes agent
 * edits from human UI edits (D1). A malformed patch or unknown id returns a
 * readable error result; `updateTask` owns validation, the audit diff, and
 * the no-op-patch no-bump behavior (D7).
 * @returns A handler that applies the patch to the card named by its `id`
 *   argument.
 */
export function createUpdateCard(): (
  args: { id: string } & UpdateTaskInput,
) => Promise<CallToolResult> {
  return async ({ id, ...patch }) => {
    try {
      const card = await updateTask(id, patch, { caller: Caller.Agent });
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
 * Builds the generic `append_progress` handler: appends one timestamped note to
 * a card's progress history by its `id` argument (preserving earlier notes). A
 * domain error (e.g. unknown id) is returned as a readable error result;
 * unexpected throws propagate.
 * @returns A handler that records the progress note on the card.
 */
export function createAppendProgress(): (args: {
  id: string;
  note: string;
}) => Promise<CallToolResult> {
  return async ({ id, note }) => {
    try {
      return toCardResult(await appendProgress(id, note));
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

/**
 * Builds the `list_recurring_due` handler: returns the recurring tasks that are
 * due for the routine to execute now (under a `tasks` key). Takes no arguments.
 * @returns A handler returning the due recurring tasks as structured content.
 */
export function createListRecurringDue(): () => Promise<CallToolResult> {
  return async () => {
    return toRecurringListResult(await listRecurringDue());
  };
}

/**
 * Builds the `start_recurring` handler: atomically claims a due task by its `id`
 * argument. A claim that loses is surfaced as a readable error result carrying
 * the distinct `ERR_ALREADY_RUNNING` / `ERR_NOT_DUE` / `ERR_NOT_FOUND` code so
 * the routine can branch (skip vs report).
 * @returns A handler that claims the task named by its `id` argument.
 */
export function createStartRecurring(): (args: {
  id: string;
}) => Promise<CallToolResult> {
  return async ({ id }) => {
    try {
      return toRecurringResult(await startRecurring(id));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the `list_recurring_runs` handler: reads the latest runs of a
 * recurring task by its `id` argument, newest first (continuity memory for the
 * routine — prior notes carry state between runs). Returns client-shaped rows
 * under a `runs` key; a domain error (e.g. unknown id) is returned as a
 * readable error result.
 * @returns A handler returning the task's latest runs as structured content.
 */
export function createListRecurringRuns(): (args: {
  id: string;
  limit?: number;
  excludeNotePrefix?: string;
}) => Promise<CallToolResult> {
  return async ({ id, limit, excludeNotePrefix }) => {
    try {
      const runs = await listLatestRecurringRuns(
        id,
        limit ?? 5,
        excludeNotePrefix,
      );
      return toRecurringRunListResult(runs.map(toClientRecurringRun));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the `complete_recurring` handler: marks a running task complete by its
 * `id` argument, recording an optional short success `note`. A domain error is
 * returned as a readable error result.
 * @returns A handler that completes the task named by its `id` argument.
 */
export function createCompleteRecurring(): (args: {
  id: string;
  note?: string;
}) => Promise<CallToolResult> {
  return async ({ id, note }) => {
    try {
      return toRecurringResult(await completeRecurring(id, { note }));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the `fail_recurring` handler: marks a running task failed by its `id`
 * argument, recording the short `error` reason. A domain error is returned as a
 * readable error result.
 * @returns A handler that fails the task named by its `id` argument.
 */
export function createFailRecurring(): (args: {
  id: string;
  error: string;
}) => Promise<CallToolResult> {
  return async ({ id, error: failure }) => {
    try {
      return toRecurringResult(await failRecurring(id, { error: failure }));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}
