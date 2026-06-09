# Remote MCP deployment — one app, board + dispatch tools, over HTTP

Extends [pool dispatch](pool-dispatch.md) (the Candidate 2′ skill-driven dispatch model) and [ADR 0001](../adr/0001-execution-architecture-staged.md) with the *deployment* shape: how the dispatch MCP server becomes a phone-reachable service instead of a local-only `stdio` process. The dispatch tool logic and the `ai-kanban-work-card` skill are unchanged — this doc only adds an **HTTP transport** and the hosting topology. Tool semantics live in [mcp-api-contract.md](mcp-api-contract.md). Settled 2026-05-31.

> **Status: implemented** (route, auth gate, and serverless Mongo caching shipped). Two design choices below were revised during implementation and are reflected inline: the adapter is **`mcp-handler@1.1.0`** (the live successor to the now-tombstoned `@vercel/mcp-adapter`), reached via a **`registerDispatchTools(server)` initializer callback** rather than a pre-built server; and the Mongo client is cached on **`globalThis`** rather than module scope. The route lives at [`app/api/mcp/route.ts`](../../app/api/mcp/route.ts).

## Why this exists

The first slice shipped the dispatch server as a **`stdio`** entry (`src/mcp/dispatch-index.ts`): it runs as a subprocess next to a Claude session on the same machine. A `stdio` server has no URL — you cannot reach it from a deployed board or register it from a session on another machine. To drive the board from a phone while away, the *data and the tools* must live behind a URL. The board (Server Components reading MongoDB) and the dispatch tools (writing the same MongoDB) are the **same backend**, so they ship as **one deployment** with **one database**.

## Topology

- **Deployed (Vercel):** the Next.js app serves both the kanban **board** (existing routes) and a new **MCP endpoint at `/api/mcp`**, backed by **MongoDB Atlas**. One deploy, one DB, one URL. (Atlas now; a self-hosted VPS Mongo is a later swap — only `MONGODB_URI` changes.)
- **At home (a real machine):** the pre-started pool of Claude sessions. They still run where there is a real shell and `git`, because the agent creates worktrees on disk itself (the code-vs-agent split from [pool-dispatch](pool-dispatch.md)). Each session registers the deployed endpoint as a remote MCP server.
- **Phone (away):** opens the deployed board URL to see/manage cards, and uses **Remote Control** to steer the already-running home sessions.

The deployment makes the *board + tools API* reachable from anywhere. The *sessions* stay on a real machine because they need git/filesystem. Cloud-run sessions with no home machine (software spawning Claude) remain the deferred **Candidate 3**.

```
 phone ──(board URL)────────────────► Vercel: Next app ──► Atlas MongoDB
   │                                     ▲  (/api/mcp)         ▲
   └──(Remote Control)──► home session ──┘  HTTP MCP calls ────┘
                              │
                              └─ git/worktrees on the home disk (agent's shell)
```

## What changes vs. what is reused

- **Reused as-is:** `createDispatchMcpServer()` and the four tool factories (`claim_card`, `get_card_context`, `set_status`, `set_workspace`). The server object is transport-agnostic — the same `McpServer` is served over either transport.
- **Reused:** the entire card service / claim / workspace / transition-policy layer and parse-on-read schemas. Deployment changes nothing below the transport.
- **Kept:** the existing `stdio` entry (`dispatch-index.ts`) for local development and offline use. HTTP is additive, not a replacement.
- **Net-new:** the `app/api/mcp/route.ts` HTTP route, a Basic-auth gate, a `globalThis`-cached Mongo client for serverless, and the env/credential surface.

## The `/api/mcp` route

- **Transport: stateless Streamable HTTP.** Vercel serverless functions do not hold long-lived in-memory MCP sessions across invocations, so we do **not** use the stateful/SSE session mode. Each of our four tools is an independent request→response call (no server-push, no streaming), so stateless mode is the correct fit and needs no session store or Redis.
- **Adapter: `mcp-handler@1.1.0`** (the live successor to the tombstoned `@vercel/mcp-adapter`). `createMcpHandler(initializeServer, serverOptions?, config?)` wraps an MCP server into a Next App-Router handler and defaults to the stateless behavior we want. Its first argument is an **initializer callback** that receives a fresh `McpServer` per request — not a pre-built server — so the route passes `(server) => registerDispatchTools(server)` (the shared registration path extracted from `createDispatchMcpServer()`). Config is `{ basePath: "/api", disableSse: true }`: `basePath: "/api"` is mandatory so the adapter derives the endpoint `/api/mcp` (the default `""` would derive `/mcp` and 404 the real request). Redis-backed SSE resumability is deliberately not enabled. **Note:** even with `disableSse: true`, the POST reply is SSE-framed (`text/event-stream`, `event: message\ndata: <json-rpc>`) — clients/tests parse the `data:` line, and requests must send `Accept: application/json, text/event-stream` + `Content-Type: application/json`.
- **Location:** `app/api/mcp/route.ts`, exporting `POST` (only — `GET`/`DELETE` 405 on the streamable endpoint) plus `export const runtime = "nodejs"` (the Mongo driver and `node:crypto` need Node, not Edge). No separate build — it ships with the normal Next build, unlike the `stdio` entry.

## Auth — Basic, gated in the route

A deployed `/api/mcp` is publicly reachable and can mutate cards, so it must be gated.

- **Mechanism:** HTTP **Basic** auth. `POST` is a wrapper that runs the gate first and only then delegates to the adapter handler. It reads the `Authorization: Basic <base64>` header, splits the decoded value on the first `:`, and compares user/pass against env credentials with `node:crypto` `timingSafeEqual` (length-guarded first — unequal-length buffers throw, which would surface as a 500 instead of a clean 401). A missing, malformed, or wrong credential returns **401** with `WWW-Authenticate: Basic` before any tool runs. `withMcpAuth` (OAuth/bearer-oriented) is deliberately not used.
- **Credentials:** a **single shared** username/password for the whole pool — `MCP_BASIC_USER` / `MCP_BASIC_PASS` in the Vercel environment. Per-session credentials are deferred (they only matter if we later need to attribute or revoke individual sessions — which the no-identity dispatch model intentionally avoids).
- **Client side:** sessions register with the credential in a header:
  `claude mcp add --transport http ai-kanban-dispatch https://<app>/api/mcp --header "Authorization: Basic <base64 user:pass>"`.
- **Additive `?token=` path (for URL-only clients):** a claude.ai cloud routine connector cannot send a custom `Authorization` header — it only carries a URL. So the gate also admits a request whose `?token=` query param holds the **same** `base64(user:pass)` used after `Basic ` in the header — **no separate secret**, validated against the same `MCP_BASIC_*` pair. The `POST` gate is an **OR**: `isAuthorized` (header) OR `isTokenAuthorized` (`?token=`); both delegate to one `validateBasicCredential(base64)` that decodes, splits on the first `:`, and constant-time-compares user+pass. It short-circuits to `false` when the configured pair is empty (unset env) or the supplied value is empty, so an unset credential can never be matched by an empty/absent token (which `safeEqual("", "")` would otherwise treat as a match — the `base64(":")` trap). When `MCP_BASIC_*` is unset the endpoint admits nothing on either path. The token rides in the URL (may appear in logs) — acceptable for the single-user pool, same sensitivity as the shared Basic credential. Cloud-routine connector setup: [recurring-routine-setup.md](../recurring-routine-setup.md).
- The gate lives in the route, *outside* the tool handlers, so the four tools stay auth-agnostic and their existing tests are unaffected.

## MongoDB on serverless

- **Cached client:** Atlas enforces connection limits and Vercel spins many short-lived function instances, so the `MongoClient` is cached on `globalThis` and reused across warm invocations (the standard serverless-driver pattern). `src/db/mongo.ts` holds the `{ client, db }` cache + in-flight `connecting` promise on a typed `globalThis.__mongo` slot so it survives across invocations and dev HMR without leaking connections; `getDb()` / `closeMongo()` keep their signatures and lazy `MONGODB_URI` / `MONGODB_DB` reads.
- **No data-model change.** The route uses the same `getDb()`, collections, and parse-on-read schemas. `MONGODB_URI` points at Atlas; `MONGODB_DB` selects the database.

## Environment surface

| Var | Where | Purpose |
|-----|-------|---------|
| `MONGODB_URI` | Vercel (+ home, if a session ever runs `stdio`) | Atlas connection string |
| `MONGODB_DB` | Vercel | Database name (optional; driver default otherwise) |
| `MCP_BASIC_USER` | Vercel | Shared Basic-auth username for `/api/mcp` (also backs the `?token=` path) |
| `MCP_BASIC_PASS` | Vercel | Shared Basic-auth password for `/api/mcp` (also backs the `?token=` path) |

## Open questions / deferred

- **Rate limiting / abuse:** a public endpoint behind one shared credential has no per-caller throttle. Deferred — acceptable for a single-user pool; revisit if the credential is shared widely.
- **Credential rotation:** rotating `MCP_BASIC_PASS` means re-running `claude mcp add` on each session. Acceptable at pool scale.
- **VPS Mongo:** swapping Atlas for a self-hosted Mongo is only a `MONGODB_URI` change plus network reachability from Vercel — no code impact.
- **Candidate 3 (cloud sessions):** software-spawned Claude with no home machine is still out of scope; this doc keeps sessions on a real machine.

## Implementation outline (BDD, test-first) — shipped

A thin slice — most logic already existed and was reused. The behaviors below ship as integration tests in `app/api/mcp/route.test.ts`:

1. **An unauthenticated MCP request is rejected.** No/wrong `Authorization` → 401 + `WWW-Authenticate: Basic`, no tool runs (asserted via a spy on the claim service).
2. **An authenticated MCP request lists the four dispatch tools.** Valid Basic cred + `tools/list` → the route serves the same four tools as the `stdio` server (SSE `data:` line parsed, exact 4-name set).
3. **An authenticated tool call acts on a card by id.** `tools/call claim_card` over HTTP claims a seeded todo card and the transition is asserted both in the SSE response and via a direct `getTask(id)` read of the shared DB.

The Mongo client reuse is a **refactor, not a behavior test** — moving the cache to `globalThis` is not user-observable, so it is guarded by the existing `mongo.test.ts` staying green rather than a new cache-identity assertion. The route reuses `registerDispatchTools` (the same four tools as `createDispatchMcpServer()`), so tool behavior is already covered by the dispatch-tools tests; the new tests cover the **transport + auth** seam only.
