import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getTask, updateTaskStatus } from "@/cards/card.service";
import type {
  Card,
  ClientDecisionEntry,
  ClientProgressEntry,
  LeanCard,
  RepoEntry,
  Status,
} from "@/cards/card.type";
import { CardView, DecisionStatus } from "@/cards/card.type";
import { AppError } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import type { RecurringTask } from "@/recurring/recurring.type";
import type { RecurringRun } from "@/recurring/recurring-run.mapper";

/**
 * What a write tool hands back in place of the card: enough to identify it and
 * confirm the write landed, with counts standing in for the entries.
 */
export interface CardAck {
  id: string;
  number: number;
  status: Status;
  decisionCount: number;
  progressCount: number;
}

/**
 * Builds a success tool result acknowledging a write: card identity, resulting
 * status, and entry counts — never the entries themselves. Echoing the whole
 * card back made each write cost more than the last as the card grew, and it
 * returned content the caller had just supplied.
 * @param card - The card as it stands after the write.
 * @returns A success tool result carrying only the acknowledgement.
 */
export function toCardAckResult(card: Card): CallToolResult {
  const ack: CardAck = {
    id: card.id,
    number: card.number,
    status: card.status,
    decisionCount: card.decisions.length,
    progressCount: card.progress.length,
  };

  return {
    structuredContent: { ...ack },
    content: [{ type: "text", text: JSON.stringify(ack) }],
  };
}

/** One still-current decision, carrying the index it is addressed by. */
export interface ResumeDecision {
  index: number;
  decision: string;
}

/** Counts of what the resume view withheld, so the reader knows to ask. */
export interface ResumeOmitted {
  outdatedDecisions: number;
  earlierProgress: number;
}

/** What a resuming session needs to re-orient, rather than the whole card. */
export interface CardResume {
  id: string;
  number: number;
  title: string;
  status: Status;
  nextAction: string | null;
  workspacePath: string | null;
  repos: RepoEntry[];
  tags: string[];
  decisions: ResumeDecision[];
  latestProgress: ClientProgressEntry | null;
  omitted: ResumeOmitted;
}

/**
 * Builds a success tool result carrying only what a session resuming after a
 * compact needs: the header, the still-current decisions, and the newest
 * progress note. Superseded decisions, every `why`, earlier notes, the
 * description and the metadata tail are withheld — `omitted` counts them so
 * the reader knows there is more to ask for.
 * @param card - The card to summarise for a resuming session.
 * @returns A success tool result carrying the resume view.
 */
export function toCardResumeResult(card: Card): CallToolResult {
  // Carry the original index: decisions are addressed positionally, so a
  // filtered list without it would silently retarget mark_decision_outdated.
  const decisions = card.decisions
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.status === DecisionStatus.Active)
    .map(({ entry, index }) => ({ index, decision: entry.decision }));

  const resume: CardResume = {
    id: card.id,
    number: card.number,
    title: card.title,
    status: card.status,
    nextAction: card.nextAction,
    workspacePath: card.workspacePath,
    repos: card.repos,
    tags: card.tags,
    decisions,
    latestProgress: card.progress.at(-1) ?? null,
    omitted: {
      outdatedDecisions: card.decisions.length - decisions.length,
      earlierProgress: Math.max(card.progress.length - 1, 0),
    },
  };

  return {
    structuredContent: { ...resume },
    content: [{ type: "text", text: JSON.stringify(resume) }],
  };
}

/** A decision entry paired with the index it is addressed by. */
export interface IndexedDecision extends ClientDecisionEntry {
  index: number;
}

/** The decision log in full, anchored to the card it belongs to. */
export interface CardDecisions {
  id: string;
  number: number;
  decisions: IndexedDecision[];
}

/**
 * Builds a success tool result carrying the decision log in full — every entry,
 * its `why`, and its supersession links. This is the follow-up for reasoning
 * the resume view withheld, so it deliberately omits the description, progress
 * notes and metadata: the point is to answer "why" without buying the card.
 * @param card - The card whose decision log to return.
 * @returns A success tool result carrying the decision log.
 */
export function toCardDecisionsResult(card: Card): CallToolResult {
  const log: CardDecisions = {
    id: card.id,
    number: card.number,
    decisions: card.decisions.map((entry, index) => ({ index, ...entry })),
  };

  return {
    structuredContent: { ...log },
    content: [{ type: "text", text: JSON.stringify(log) }],
  };
}

/**
 * Builds a success tool result for a card: the card as structured content plus
 * a JSON text mirror. Spreading into a record satisfies the SDK's
 * `structuredContent` index-signature shape.
 * @param card - The card to return to the agent.
 * @returns A success tool result.
 */
export function toCardResult(card: Card): CallToolResult {
  return {
    structuredContent: { ...card },
    content: [{ type: "text", text: JSON.stringify(card) }],
  };
}

/**
 * Builds a success tool result for a recurring task: the task as structured
 * content plus a JSON text mirror. Mirrors {@link toCardResult}.
 * @param task - The recurring task to return to the routine.
 * @returns A success tool result.
 */
export function toRecurringResult(task: RecurringTask): CallToolResult {
  return {
    structuredContent: { ...task },
    content: [{ type: "text", text: JSON.stringify(task) }],
  };
}

/**
 * Builds a success tool result for a list of recurring tasks. The array is
 * wrapped under a `tasks` key because `structuredContent` must be an object,
 * not a bare array.
 * @param tasks - The recurring tasks to return to the routine.
 * @returns A success tool result.
 */
export function toRecurringListResult(tasks: RecurringTask[]): CallToolResult {
  return {
    structuredContent: { tasks },
    content: [{ type: "text", text: JSON.stringify(tasks) }],
  };
}

/**
 * Builds a success tool result for a recurring task's run history. The array is
 * wrapped under a `runs` key because `structuredContent` must be an object,
 * not a bare array. Mirrors {@link toRecurringListResult}.
 * @param runs - The client-shaped run-history rows, newest first.
 * @returns A success tool result.
 */
export function toRecurringRunListResult(runs: RecurringRun[]): CallToolResult {
  return {
    structuredContent: { runs },
    content: [{ type: "text", text: JSON.stringify(runs) }],
  };
}

/**
 * Builds a success tool result for a list of lean cards. The array is wrapped
 * under a `cards` key because `structuredContent` must be an object, not a
 * bare array. Mirrors {@link toRecurringListResult}.
 * @param cards - The lean cards to return to the agent.
 * @returns A success tool result.
 */
export function toCardListResult(cards: LeanCard[]): CallToolResult {
  return {
    structuredContent: { cards },
    content: [{ type: "text", text: JSON.stringify(cards) }],
  };
}

/**
 * Maps a domain {@link AppError} into an MCP error tool result. The `ERR_*`
 * code is embedded in both the text content and the structured content so the
 * agent can read and react to it. `isError: true` exempts the result from the
 * tool's success `outputSchema`.
 * @param error - The domain error to surface to the agent.
 * @returns A tool result flagged as an error.
 */
export function appErrorToToolResult(error: AppError): CallToolResult {
  return {
    isError: true,
    structuredContent: { code: error.code, message: error.message },
    content: [{ type: "text", text: `${error.code}: ${error.message}` }],
  };
}

/**
 * Builds the `get_my_task` handler bound to a single card. The agent reads only
 * its own card; a domain error is returned as a readable error result.
 * @param cardId - The card the session is scoped to.
 * @returns A handler returning the bound card as success structured content.
 */
export function createGetMyTask(
  cardId: string,
): (args?: { view?: CardView }) => Promise<CallToolResult> {
  return async ({ view } = {}) => {
    try {
      const card = await getTask(cardId);
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
 * Builds the `set_my_status` handler bound to a single card. The agent moves
 * only its own card, but to any status (any-to-any parity with the webview,
 * enforced by the service as the {@link Caller.Agent} caller); a missing card
 * is returned as a readable error result.
 * @param cardId - The card the session is scoped to.
 * @returns A handler that applies the requested status to the bound card.
 */
export function createSetMyStatus(
  cardId: string,
): (args: { status: Status; force?: boolean }) => Promise<CallToolResult> {
  return async ({ status, force }) => {
    try {
      const card = await updateTaskStatus(cardId, status, {
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
