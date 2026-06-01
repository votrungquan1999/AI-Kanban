import { describe, expect, it, vi } from "vitest";
import * as claimService from "@/cards/card.claim.service";
import { createTask, getTask } from "@/cards/card.service";
import { OriginType, Status } from "@/cards/card.type";
import { useTestMongo } from "@/test/use-test-mongo";

const MCP_URL = "https://example.test/api/mcp";
const TOOLS_CALL_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "claim_card", arguments: { id: "anything" } },
});

/**
 * Builds the `Authorization: Basic` header value for the given credentials.
 * @param user - Basic-auth username.
 * @param pass - Basic-auth password.
 * @returns The full header value (`Basic <base64>`).
 */
function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/**
 * Parses an mcp-handler Streamable-HTTP response. The transport answers a
 * JSON-RPC request over an SSE stream (`event: message\ndata: <json>\n\n`), so
 * the JSON-RPC payload lives on the `data:` line, not in `response.json()`.
 * @param response - The response returned by the route handler.
 * @returns The parsed JSON-RPC message.
 */
async function parseMcpResponse(response: Response): Promise<{
  result?: {
    tools?: { name: string }[];
    structuredContent?: { id?: string; status?: string };
  };
}> {
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`no SSE data line in response: ${text}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
}

describe("POST /api/mcp — auth gate", () => {
  it("rejects a request with no credentials with 401 and runs no tool", async () => {
    // Given configured Basic-auth credentials and a watched claim tool
    process.env.MCP_BASIC_USER = "agent";
    process.env.MCP_BASIC_PASS = "secret";
    const claimSpy = vi.spyOn(claimService, "claimCard");
    const { POST } = await import("./route");

    // When a well-formed MCP tools/call arrives with no Authorization header
    const res = await POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: TOOLS_CALL_BODY,
      }),
    );

    // Then it is rejected with 401 + a Basic challenge, and no tool ran
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
    expect(claimSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp — tools/list", () => {
  it("lists exactly the four dispatch tools for an authenticated caller", async () => {
    // Given valid Basic credentials
    process.env.MCP_BASIC_USER = "mcp-user";
    process.env.MCP_BASIC_PASS = "mcp-pass";
    const { POST } = await import("./route");

    // When an authenticated JSON-RPC tools/list request arrives
    const res = await POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuth("mcp-user", "mcp-pass"),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
    );

    // Then exactly the four dispatch tools are advertised — nothing more
    const message = await parseMcpResponse(res);
    const names = (message.result?.tools ?? []).map((tool) => tool.name);
    expect(names.sort()).toEqual([
      "claim_card",
      "get_card_context",
      "set_status",
      "set_workspace",
    ]);
  });
});

describe("POST /api/mcp — tools/call claim_card", () => {
  useTestMongo();

  it("claims a seeded todo card by id and persists the transition", async () => {
    // Given valid credentials and a todo card waiting to be claimed
    process.env.MCP_BASIC_USER = "mcp-user";
    process.env.MCP_BASIC_PASS = "mcp-pass";
    const created = await createTask({
      title: "claim over http",
      origin: { type: OriginType.Manual },
    });
    const { POST } = await import("./route");

    // When an authenticated tools/call claim_card arrives with the card id
    const res = await POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuth("mcp-user", "mcp-pass"),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "claim_card", arguments: { id: created.id } },
        }),
      }),
    );

    // Then the tool returns the claimed card in progress
    const message = await parseMcpResponse(res);
    expect(message.result?.structuredContent).toMatchObject({
      id: created.id,
      status: Status.InProgress,
    });

    // And the transition is persisted in the shared database
    const persisted = await getTask(created.id);
    expect(persisted.status).toBe(Status.InProgress);
  });
});
