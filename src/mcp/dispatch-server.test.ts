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
  it("registers exactly the ten card tools plus the five recurring queue tools", async () => {
    // Given the generic dispatch server, When a client connects and lists tools
    const client = await connectClient();
    const { tools } = await client.listTools();

    // Then exactly the fifteen dispatch tools are exposed — nothing more
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "append_decision",
      "append_progress",
      "claim_card",
      "complete_recurring",
      "create_card",
      "fail_recurring",
      "get_card_context",
      "list_cards",
      "list_recurring_due",
      "list_recurring_runs",
      "mark_decision_outdated",
      "set_status",
      "set_workspace",
      "start_recurring",
      "update_card",
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

  it("rejects a negative decision index before any handler runs", async () => {
    // Given a connected client
    const client = await connectClient();

    // When it marks a decision outdated with a negative index, Then the SDK's
    // schema boundary refuses the call with a validation error result (no DB
    // is configured here — reaching a handler would fail differently, proving
    // rejection happened pre-handler)
    const result = await client.callTool({
      name: "mark_decision_outdated",
      arguments: { id: new ObjectId().toHexString(), index: -1 },
    });
    expect(result.isError).toBe(true);
    const [first] = result.content as { type: string; text: string }[];
    expect(first.text).toContain("Input validation error");

    await client.close();
  });

  it("cues an agent when to record a decision vs a routine progress note, and that get_card_context returns the decision log", async () => {
    // Given the generic dispatch server, When a client connects and lists tools
    const client = await connectClient();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.description]),
    );

    // Then append_decision cues a choice/tradeoff, distinct from routine progress
    expect(byName.append_decision).toContain("tradeoff");
    // And append_progress cues a routine checkpoint, not the why of a choice
    expect(byName.append_progress).toContain("routine checkpoint");
    // And get_card_context tells the caller it returns the decision log
    expect(byName.get_card_context).toContain("decision log");
    // And mark_decision_outdated tells the caller its index is 0-based
    expect(byName.mark_decision_outdated).toContain("0-based");

    await client.close();
  });
});
