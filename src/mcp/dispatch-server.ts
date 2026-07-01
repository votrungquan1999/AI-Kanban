import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cardIdSchema,
  createCardInputSchema,
  progressNoteSchema,
  statusSchema,
} from "@/cards/card.schema";
import { workspaceDeclarationSchema } from "@/cards/card.workspace.service";
import {
  createAppendProgress,
  createClaimCard,
  createCompleteRecurring,
  createCreateCard,
  createFailRecurring,
  createGetCardContext,
  createListRecurringDue,
  createListRecurringRuns,
  createSetStatus,
  createSetWorkspace,
  createStartRecurring,
} from "@/mcp/dispatch-tools";
import { recurringIdSchema } from "@/recurring/recurring.schema";

/**
 * Registers the generic dispatch tools — the six card tools (`claim_card`,
 * `create_card`, `append_progress`, `get_card_context`, `set_status`,
 * `set_workspace`) plus the five recurring queue tools
 * (`list_recurring_due`, `list_recurring_runs`,
 * `start_recurring`, `complete_recurring`, `fail_recurring`) — onto an MCP
 * server. Shared by both the stdio factory ({@link createDispatchMcpServer})
 * and the HTTP route's adapter initializer, so the tool set has a single
 * source of truth across transports.
 * @param server - The MCP server to register the dispatch tools onto.
 */
export function registerDispatchTools(server: McpServer): void {
  server.registerTool(
    "claim_card",
    {
      description: "Atomically claim a todo card by id (todo -> in_progress).",
      inputSchema: { id: cardIdSchema },
    },
    createClaimCard(),
  );

  server.registerTool(
    "create_card",
    {
      description:
        "Create a session-tracked card that starts directly in_progress, with tags and the session id.",
      inputSchema: createCardInputSchema.shape,
    },
    createCreateCard(),
  );

  server.registerTool(
    "append_progress",
    {
      description:
        "Append a short timestamped progress note to a card by id (preserves earlier notes).",
      inputSchema: { id: cardIdSchema, note: progressNoteSchema },
    },
    createAppendProgress(),
  );

  server.registerTool(
    "get_card_context",
    {
      description: "Read a card's task context by id.",
      inputSchema: { id: cardIdSchema },
    },
    createGetCardContext(),
  );

  server.registerTool(
    "set_status",
    {
      description:
        "Move a card to a new status by id along a legal agent edge.",
      inputSchema: { id: cardIdSchema, status: statusSchema },
    },
    createSetStatus(),
  );

  server.registerTool(
    "set_workspace",
    {
      description:
        "Declare a card's full workspace state by id (replaces prior state).",
      inputSchema: { id: cardIdSchema, ...workspaceDeclarationSchema.shape },
    },
    createSetWorkspace(),
  );

  server.registerTool(
    "list_recurring_due",
    {
      description:
        "List the recurring tasks that are due to run now (enabled, idle, due).",
      inputSchema: {},
    },
    createListRecurringDue(),
  );

  server.registerTool(
    "list_recurring_runs",
    {
      description:
        "Read a recurring task's latest runs by id, newest first (default 5, max 20). Prior run notes carry context between runs — read them after claiming to continue where the last run left off. Pass excludeNotePrefix to drop runs whose note starts with it (e.g. \"skipped\") so idle-window markers don't bury the last note that holds real state.",
      inputSchema: {
        id: recurringIdSchema,
        limit: z.number().int().min(1).max(20).optional(),
        excludeNotePrefix: z.string().min(1).optional(),
      },
    },
    createListRecurringRuns(),
  );

  server.registerTool(
    "start_recurring",
    {
      description:
        "Atomically claim a due recurring task by id (idle -> running).",
      inputSchema: { id: recurringIdSchema },
    },
    createStartRecurring(),
  );

  server.registerTool(
    "complete_recurring",
    {
      description:
        "Mark a running recurring task complete by id, with an optional note.",
      inputSchema: { id: recurringIdSchema, note: z.string().optional() },
    },
    createCompleteRecurring(),
  );

  server.registerTool(
    "fail_recurring",
    {
      description:
        "Mark a running recurring task failed by id, recording the error reason.",
      inputSchema: { id: recurringIdSchema, error: z.string().min(1) },
    },
    createFailRecurring(),
  );
}

/**
 * Builds the generic dispatch MCP server. Unlike the card-scoped
 * {@link createMcpServer}, it carries no session identity: it constructs the
 * server and delegates tool registration to {@link registerDispatchTools},
 * exposing exactly eleven tools so any pre-started session can act on any card
 * (under the `/ai-kanban-work-card` skill's direction) or process the recurring
 * queue.
 * @returns A configured {@link McpServer} ready to connect to a transport.
 */
export function createDispatchMcpServer(): McpServer {
  const server = new McpServer({
    name: "ai-kanban-dispatch",
    version: "1.0.0",
  });

  registerDispatchTools(server);

  return server;
}
