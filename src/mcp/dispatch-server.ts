import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cardIdSchema, statusSchema } from "@/cards/card.schema";
import { workspaceDeclarationSchema } from "@/cards/card.workspace.service";
import {
  createClaimCard,
  createCompleteRecurring,
  createFailRecurring,
  createGetCardContext,
  createListRecurringDue,
  createSetStatus,
  createSetWorkspace,
  createStartRecurring,
} from "@/mcp/dispatch-tools";
import { recurringIdSchema } from "@/recurring/recurring.schema";

/**
 * Registers the four generic id-argument dispatch tools — `claim_card`,
 * `get_card_context`, `set_status`, `set_workspace` — onto an MCP server.
 * Shared by both the stdio factory ({@link createDispatchMcpServer}) and the
 * HTTP route's adapter initializer, so the tool set has a single source of
 * truth across transports.
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
 * exposing exactly four id-argument tools so any pre-started session can act on
 * any card under the `/ai-kanban-work-card` skill's direction.
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
