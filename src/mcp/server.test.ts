import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "@/mcp/server";

describe("createMcpServer", () => {
  it("registers exactly get_my_task and set_my_status", async () => {
    // Given a server scoped to a card
    const server = createMcpServer({ cardId: "a".repeat(24) });

    // When a client connects over an in-memory transport and lists tools
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    const { tools } = await client.listTools();

    // Then exactly the two card-scoped agent tools are exposed
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_my_task",
      "set_my_status",
    ]);

    await client.close();
  });
});
