import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getTask, updateTaskStatus } from "@/cards/card.service";
import type { Card, Status } from "@/cards/card.type";
import { AppError } from "@/cards/errors";
import { Caller } from "@/cards/transition-policy";
import type { RecurringTask } from "@/recurring/recurring.type";

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
export function createGetMyTask(cardId: string): () => Promise<CallToolResult> {
  return async () => {
    try {
      return toCardResult(await getTask(cardId));
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
 * only its own card, and only along its legal lifecycle edges (enforced by the
 * service as the {@link Caller.Agent} caller); an illegal move or missing card
 * is returned as a readable error result.
 * @param cardId - The card the session is scoped to.
 * @returns A handler that applies the requested status to the bound card.
 */
export function createSetMyStatus(
  cardId: string,
): (args: { status: Status }) => Promise<CallToolResult> {
  return async ({ status }) => {
    try {
      const card = await updateTaskStatus(cardId, status, {
        caller: Caller.Agent,
      });
      return toCardResult(card);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToToolResult(error);
      }
      throw error;
    }
  };
}
