import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { adoptCard } from "@/cards/card.adopt.service";
import { claimCard } from "@/cards/card.claim.service";
import {
  appendDecision,
  markDecisionOutdated,
} from "@/cards/card.decision.service";
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
import { CardView } from "@/cards/card.type";
import { setWorkspace } from "@/cards/card.workspace.service";
import { AppError } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import {
  appErrorToToolResult,
  toCardAckResult,
  toCardDecisionsResult,
  toCardListResult,
  toCardResult,
  toCardResumeResult,
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
      return toCardAckResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `create_card` handler: by default (or status:in_progress)
 * a session starts tracking its work as a card that lands directly in_progress,
 * carrying the session's labels and handle; any other status files a standalone,
 * session-less card at that placement. A domain error (e.g. invalid input) is
 * returned as a readable error result; unexpected throws propagate.
 * @returns A handler that creates the card from its arguments.
 */
export function createCreateCard(): (args: {
  title: string;
  description?: string;
  tags: string[];
  sessionId?: string;
  nextAction?: string;
  forceNew?: boolean;
  status?: Status;
}) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return toCardAckResult(await createCard(args));
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
 * a keyword match on title/description, relevance-ranked best-first and
 * spanning every status unless `status` was given; each falls through to "not
 * applied" when empty/whitespace/omitted. `limit` caps the count (default ~50,
 * capped at 200 — see {@link listCards}).
 *
 * A keyword search issued while the board's search index is missing returns a
 * readable `ERR_SEARCH_UNAVAILABLE` result — the agent must be able to tell
 * that apart from "no card matched", or it opens a duplicate.
 * @returns A handler returning the lean cards under a `cards` key.
 */
export function createListCards(): (args: {
  status?: Status[];
  tags?: string[];
  limit?: number;
  text?: string;
}) => Promise<CallToolResult> {
  return async ({ status, tags, limit, text }) => {
    try {
      return toCardListResult(await listCards({ status, tags, limit, text }));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
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
      return toCardAckResult(card);
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
      return toCardAckResult(await appendProgress(id, note));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `append_decision` handler: records one timestamped
 * decision (with an optional short reason) on a card's durable decision log by
 * its `id` argument (preserving earlier decisions). A domain error (e.g.
 * unknown id, blank decision) is returned as a readable error result;
 * unexpected throws propagate.
 * @returns A handler that records the decision on the card.
 */
export function createAppendDecision(): (args: {
  id: string;
  decision: string;
  why?: string;
}) => Promise<CallToolResult> {
  return async ({ id, decision, why }) => {
    try {
      return toCardAckResult(await appendDecision(id, decision, why));
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `mark_decision_outdated` handler: marks one decision in a
 * card's decision log outdated by its `id` argument and the decision's index,
 * optionally noting which later decision replaced it. A domain error (e.g.
 * unknown id, bad index, self-reference) is returned as a readable error
 * result; unexpected throws propagate.
 * @returns A handler that marks the decision outdated on the card.
 */
export function createMarkDecisionOutdated(): (args: {
  id: string;
  index: number;
  supersededByIndex?: number;
}) => Promise<CallToolResult> {
  return async ({ id, index, supersededByIndex }) => {
    try {
      return toCardAckResult(
        await markDecisionOutdated(id, index, supersededByIndex),
      );
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
  view?: CardView;
}) => Promise<CallToolResult> {
  return async ({ id, view }) => {
    try {
      const card = await getTask(id);
      switch (view) {
        case CardView.Full:
          return toCardResult(card);
        case CardView.Decisions:
          return toCardDecisionsResult(card);
        default:
          return toCardResumeResult(card);
      }
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the generic `set_status` handler, moving any card to any status by
 * its `id` argument as the agent caller (any-to-any parity with the webview).
 * A missing card is returned as a readable error result rather than thrown;
 * the underlying `updateTaskStatus` emits the audit row.
 * @returns A handler that applies the requested status to the card.
 */
export function createSetStatus(): (args: {
  id: string;
  status: Status;
  force?: boolean;
}) => Promise<CallToolResult> {
  return async ({ id, status, force }) => {
    try {
      const card = await updateTaskStatus(id, status, {
        caller: Caller.Agent,
        force,
      });
      return toCardAckResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}

/**
 * Builds the `adopt_card` handler: hands an existing card to the session now
 * working it, so the server's own idempotency recognises the adoption and a
 * later `create_card` from that session reclaims this card instead of opening
 * a second one. A card the session cannot take over (it already holds an open
 * card) comes back as a readable `ERR_DUPLICATE` result rather than a silently
 * dropped re-stamp.
 * @returns A handler that transfers the card to the calling session.
 */
export function createAdoptCard(): (args: {
  id: string;
  sessionId: string;
}) => Promise<CallToolResult> {
  return async ({ id, sessionId }) => {
    try {
      return toCardAckResult(await adoptCard(id, sessionId));
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
      return toCardAckResult(card);
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
