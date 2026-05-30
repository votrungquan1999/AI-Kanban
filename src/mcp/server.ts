import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { statusSchema } from "@/cards/card.schema";
import { createGetMyTask, createSetMyStatus } from "@/mcp/tools";

/** Options for {@link createMcpServer}. */
interface CreateMcpServerOptions {
  cardId: string;
}

/**
 * Builds the card-scoped MCP server for one Claude Code session. It exposes
 * exactly two agent tools, both bound to `cardId`: `get_my_task` (read the
 * session's card) and `set_my_status` (move it along a legal edge). The caller
 * is responsible for providing an already-validated `cardId`.
 * @param options - The session scope ({@link CreateMcpServerOptions.cardId}).
 * @returns A configured {@link McpServer} ready to connect to a transport.
 */
export function createMcpServer({ cardId }: CreateMcpServerOptions): McpServer {
  const server = new McpServer({ name: "ai-kanban", version: "1.0.0" });

  server.registerTool(
    "get_my_task",
    { description: "Read the card this session is assigned to." },
    createGetMyTask(cardId),
  );

  server.registerTool(
    "set_my_status",
    {
      description:
        "Move this session's card to a new status along a legal edge.",
      inputSchema: { status: statusSchema },
    },
    createSetMyStatus(cardId),
  );

  return server;
}
