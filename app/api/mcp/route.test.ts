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
 * Builds the bare `base64(user:pass)` token for the `?token=` URL path — the
 * same encoded credential that follows `Basic ` in the header.
 * @param user - Basic-auth username.
 * @param pass - Basic-auth password.
 * @returns The base64-encoded `user:pass` string.
 */
function basicToken(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass}`).toString("base64");
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
  it("lists exactly the fifteen dispatch tools for an authenticated caller", async () => {
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

    // Then exactly the fifteen dispatch tools are advertised — nothing more
    const message = await parseMcpResponse(res);
    const names = (message.result?.tools ?? []).map((tool) => tool.name);
    expect(names.sort()).toEqual([
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

describe("POST /api/mcp — token auth rejection", () => {
  it("rejects a ?token= whose base64 credential does not match, with 401 and no tool", async () => {
    // Given configured Basic credentials and a watched claim tool
    process.env.MCP_BASIC_USER = "mcp-user";
    process.env.MCP_BASIC_PASS = "mcp-pass";
    const claimSpy = vi.spyOn(claimService, "claimCard");
    claimSpy.mockClear(); // file has no global mock reset; drop calls leaked from earlier describes
    const { POST } = await import("./route");

    // When a tools/call arrives carrying the wrong base64(user:pass) as ?token=
    const res = await POST(
      new Request(`${MCP_URL}?token=${basicToken("mcp-user", "wrong-pass")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: TOOLS_CALL_BODY,
      }),
    );

    // Then it is rejected with 401 and no tool ran
    expect(res.status).toBe(401);
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("rejects ?token=Og== (base64 of ':') when credentials are unset, with 401 and no tool", async () => {
    // Given NO configured credentials — the empty-equality trap: base64 ":" decodes
    // to empty user + empty pass, which a naive compare would match against unset env
    delete process.env.MCP_BASIC_USER;
    delete process.env.MCP_BASIC_PASS;
    const claimSpy = vi.spyOn(claimService, "claimCard");
    claimSpy.mockClear(); // file has no global mock reset; drop calls leaked from earlier describes
    const { POST } = await import("./route");

    // When a tools/call arrives with ?token= decoding to "" : "" against unset creds
    const res = await POST(
      new Request(`${MCP_URL}?token=${basicToken("", "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: TOOLS_CALL_BODY,
      }),
    );

    // Then the empty-credential short-circuit rejects it — 401, no tool ran
    expect(res.status).toBe(401);
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("rejects a request with neither a Basic header nor a ?token=, with 401", async () => {
    // Given credentials are configured but the request supplies nothing
    process.env.MCP_BASIC_USER = "mcp-user";
    process.env.MCP_BASIC_PASS = "mcp-pass";
    const claimSpy = vi.spyOn(claimService, "claimCard");
    claimSpy.mockClear(); // file has no global mock reset; drop calls leaked from earlier describes
    const { POST } = await import("./route");

    // When a tools/call arrives with no Authorization header and no ?token=
    const res = await POST(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: TOOLS_CALL_BODY,
      }),
    );

    // Then the gate admits nothing without a credential — 401, no tool ran
    expect(res.status).toBe(401);
    expect(claimSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp — token auth via ?token=", () => {
  useTestMongo();

  it("admits a request with a valid base64 ?token= and runs the tool", async () => {
    // Given configured Basic credentials (reused as the URL token) and a todo card
    process.env.MCP_BASIC_USER = "mcp-user";
    process.env.MCP_BASIC_PASS = "mcp-pass";
    const created = await createTask({
      title: "claim via token",
      origin: { type: OriginType.Manual },
    });
    const { POST } = await import("./route");

    // When a tools/call claim_card arrives with ?token=base64(user:pass), no Authorization header
    const res = await POST(
      new Request(`${MCP_URL}?token=${basicToken("mcp-user", "mcp-pass")}`, {
        method: "POST",
        headers: {
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
