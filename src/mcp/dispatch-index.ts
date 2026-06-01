import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDispatchMcpServer } from "@/mcp/dispatch-server";

/**
 * Builds the generic dispatch MCP server and serves it over stdio. Unlike the
 * card-scoped entry, it reads no environment and requires no identity — a
 * pre-started session is told which card to act on at call time via each tool's
 * id argument. The transport-connect line opens real stdio handles, so it is
 * exercised only when run as the entry process — never under test.
 */
export async function main(): Promise<void> {
  const server = createDispatchMcpServer();
  await server.connect(new StdioServerTransport());
}

// Auto-run only when executed directly (e.g. `node dist/mcp/dispatch-index.js`),
// so importing this module (in tests) is side-effect-free and never opens stdio.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
