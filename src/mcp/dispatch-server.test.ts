import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createDispatchMcpServer } from "@/mcp/dispatch-server";

describe("createDispatchMcpServer", () => {
  it("registers exactly the four card tools plus the four recurring queue tools", async () => {
    // Given the generic dispatch server
    const server = createDispatchMcpServer();

    // When a client connects over an in-memory transport and lists tools
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    const { tools } = await client.listTools();

    // Then exactly the eight id-argument dispatch tools are exposed — nothing more
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "claim_card",
      "complete_recurring",
      "fail_recurring",
      "get_card_context",
      "list_recurring_due",
      "set_status",
      "set_workspace",
      "start_recurring",
    ]);

    await client.close();
  });
});
