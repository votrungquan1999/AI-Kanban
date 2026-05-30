import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cardIdSchema } from "@/cards/card.schema";
import { createMcpServer } from "@/mcp/server";

/**
 * Reads and validates `CARD_ID` from the process environment. This is the
 * startup boundary: a missing or malformed value throws (fail fast) before any
 * transport is opened.
 * @returns The validated card id this session is scoped to.
 */
export function readCardId(): string {
  return cardIdSchema.parse(process.env.CARD_ID);
}

/**
 * Builds the card-scoped MCP server and serves it over stdio. The
 * transport-connect line opens real stdio handles, so this is exercised only
 * when run as the entry process — never under test.
 */
export async function main(): Promise<void> {
  const cardId = readCardId();
  const server = createMcpServer({ cardId });
  await server.connect(new StdioServerTransport());
}

// Auto-run only when executed directly (e.g. `node dist/mcp/index.js`), so that
// importing this module (in tests) is side-effect-free and never opens stdio.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
