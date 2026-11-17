import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cardViewSchema, statusSchema } from "@/cards/card.schema";
import { createGetMyTask, createSetMyStatus } from "@/mcp/tools";

/** Options for {@link createMcpServer}. */
interface CreateMcpServerOptions {
  cardId: string;
}

/**
 * Builds the card-scoped MCP server for one Claude Code session. It exposes
 * exactly two agent tools, both bound to `cardId`: `get_my_task` (read the
 * session's card) and `set_my_status` (move it to any status — any-to-any
 * parity with the webview). The caller is responsible for providing an
 * already-validated `cardId`.
 * @param options - The session scope ({@link CreateMcpServerOptions.cardId}).
 * @returns A configured {@link McpServer} ready to connect to a transport.
 */
export function createMcpServer({ cardId }: CreateMcpServerOptions): McpServer {
  const server = new McpServer({ name: "ai-kanban", version: "1.0.0" });

  server.registerTool(
    "get_my_task",
    {
      description:
        "Read the card this session is assigned to. Defaults to a lean resume view: the header, still-current decisions, the newest progress note, and counts of what was left out. Pass view:'decisions' for the full decision log with the why behind each, or view:'full' for the entire card.",
      inputSchema: { view: cardViewSchema.optional() },
    },
    createGetMyTask(cardId),
  );

  server.registerTool(
    "set_my_status",
    {
      description:
        "Move this session's card to any status — the agent has full any-to-any parity with a person on the webview. Pass force:true only if the move is refused with ERR_DUPLICATE — it displaces the open card holding the same import dedupeKey; confirm with the user before using it.",
      inputSchema: { status: statusSchema, force: z.boolean().optional() },
    },
    createSetMyStatus(cardId),
  );

  return server;
}
