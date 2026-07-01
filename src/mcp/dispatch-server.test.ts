import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createDispatchMcpServer } from "@/mcp/dispatch-server";

/**
 * Connects an in-memory client to a fresh dispatch server for transport-level
 * assertions (tool discovery, SDK-side input validation).
 * @returns The connected client, ready to list and call tools.
 */
async function connectClient(): Promise<Client> {
  const server = createDispatchMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe("createDispatchMcpServer", () => {
  it("registers exactly the six card tools plus the five recurring queue tools", async () => {
    // Given the generic dispatch server, When a client connects and lists tools
    const client = await connectClient();
    const { tools } = await client.listTools();

    // Then exactly the eleven dispatch tools are exposed — nothing more
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "append_progress",
      "claim_card",
      "complete_recurring",
      "create_card",
      "fail_recurring",
      "get_card_context",
      "list_recurring_due",
      "list_recurring_runs",
      "set_status",
      "set_workspace",
      "start_recurring",
    ]);

    await client.close();
  });

  it("rejects a run-history request above the 20-run cap before any handler runs", async () => {
    // Given a connected client
    const client = await connectClient();

    // When it asks for more history than the cap allows, Then the SDK's schema
    // boundary refuses the call with a validation error result naming the cap
    // (no DB is configured here — reaching a handler would fail differently,
    // proving rejection happened pre-handler)
    const result = await client.callTool({
      name: "list_recurring_runs",
      arguments: { id: new ObjectId().toHexString(), limit: 21 },
    });
    expect(result.isError).toBe(true);
    const [first] = result.content as { type: string; text: string }[];
    expect(first.text).toContain("Input validation error");
    expect(first.text).toContain("<=20");

    await client.close();
  });
});
