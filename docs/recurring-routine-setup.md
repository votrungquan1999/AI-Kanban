# Recurring-Task Routine Setup

How to wire a Claude cloud **routine** (scheduled cron run) to process AI-Kanban's recurring-task queue. The routine periodically lists due recurring tasks over the deployed MCP connector, executes each task's instruction, and reports the result back. This is the scheduler half of the Recurring Tasks feature — the app code never requires a live routine to run or to pass CI.

Related: the committed skill [`.claude/skills/run-recurring-queue/SKILL.md`](../.claude/skills/run-recurring-queue/SKILL.md) (the loop the routine runs); the connector deployment doc [`docs/design/remote-mcp-deployment.md`](./design/remote-mcp-deployment.md); the design rationale in [`docs/brainstorm/next-feature/`](./brainstorm/next-feature/README.md).

> **As actually deployed (2026-06-10):** the operator's claude.ai org has **custom connectors disabled**, so the connector path in §1A below is not usable. Instead the routine drives the MCP endpoint **directly over `curl`**, with the token embedded in its prompt — no connector, no skill upload, no home machine. The copy-paste runbook for re-creating it is **§0 below**; §1–§4 remain as reference for the connector-based path if connectors are ever enabled.

## 0. Runbook — re-create the cloud routine over curl (no connector)

Use this when asked to "set up the recurring routine again." It needs nothing in the claude.ai connector UI.

**Step 1 — get the auth token.** The deploy is provisioned by the sibling repo `personal-infra` (Pulumi → Vercel). Domain `ai-kanban.quanvo.dev`; `MCP_BASIC_USER` = `ai-kanban-agent`; `MCP_BASIC_PASS` = Pulumi secret output `aiKanbanMcpBasicPass`. Retrieve and base64-encode it:

```bash
cd <path>/personal-infra && set -a && . ./.env && set +a   # loads PULUMI_ACCESS_TOKEN; stack votrungquan1999/prod
PASS=$(pulumi stack output aiKanbanMcpBasicPass --show-secrets)   # NOT --stack prod (use selected stack)
printf '%s' "ai-kanban-agent:$PASS" | base64                      # => the <TOKEN>
```

**Step 2 — verify the token authenticates** (expect a JSON-RPC line listing 9 tools / `{"tasks":[]}`):

```bash
curl -s -X POST "https://ai-kanban.quanvo.dev/api/mcp?token=<TOKEN>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_recurring_due","arguments":{}}}' | sed -n 's/^data: //p'
```

**Step 3 — create the routine** via the `RemoteTrigger` tool (`action: "create"`), repo-less, every 3 hours. Key body fields:
- `cron_expression: "0 */3 * * *"` (every 3h; min floor is 1h), `enabled: true`
- `job_config.ccr.environment_id`: an `anthropic_cloud` env id (list via `/schedule`; was `env_01YCe4F1s4Rxp7KMWrezGszJ`)
- `session_context`: `{ model: "claude-sonnet-4-6", sources: [], allowed_tools: ["Bash", "WebSearch", "WebFetch"] }`
- `events[0].data`: `{ uuid: <fresh v4>, session_id: "", type: "user", parent_tool_use_id: null, message: { role: "user", content: <PROMPT> } }`

`<PROMPT>` (embeds the token; instructs the agent to drive the queue over curl):

> You are a scheduled run that processes the AI-Kanban recurring-task queue. There is NO MCP connector — call the JSON-RPC endpoint directly over HTTPS with curl (Bash); it is stateless (POST one request, read the `data:` SSE line). URL (secret — never print it): `https://ai-kanban.quanvo.dev/api/mcp?token=<TOKEN>`. To call tool TOOL with args OBJ: `curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL","arguments":OBJ}}' | sed -n 's/^data: //p'`. Then: (1) call `list_recurring_due` with `{}`; read `result.structuredContent.tasks`; if empty, exit cleanly. (2) For each task: `start_recurring {"id":"…"}` — on `isError` read `structuredContent.code` and SKIP (ERR_ALREADY_RUNNING / ERR_NOT_DUE / ERR_NOT_FOUND), no retry; else, if the instruction builds on earlier runs, first call `list_recurring_runs {"id":"…"}` (latest runs newest-first, default 5) and read the latest note as your continuity memory; then carry out the task's `instruction`; then report exactly once — `complete_recurring {"id":"…","note":"…"}` on success or `fail_recurring {"id":"…","error":"…"}` on failure. A clean exit is NOT success — you MUST report every claimed task. Isolate per-task failures. Never print the token. Only act on ids from `list_recurring_due`.

**Step 4 — test + view.** `RemoteTrigger` `action: "run"` to fire once now; transcripts at `https://claude.ai/code/routines/<trigger_id>` (the API does not return run output). Add a recurring task on `/recurring` and Run-now to exercise a real claim→complete.

**Rotation.** Change `MCP_BASIC_PASS` in Pulumi/Vercel → recompute `<TOKEN>` (Step 1) → `RemoteTrigger` `update` the routine prompt. Current routine: `trig_01X7MotrGpfKLKwHZPk1gVth`.

## 1. Register the MCP connector (one-time)

The recurring queue tools (`list_recurring_due`, `start_recurring`, `list_recurring_runs`, `complete_recurring`, `fail_recurring`) register through the **same** `ai-kanban-dispatch` connector as the existing card dispatch tools — there is no separate connector. There are two registration paths depending on **where the connector lives**, because they authenticate differently:

**A. A scheduled routine (cloud) — use the URL `?token=` path.** A routine runs in Claude's cloud sandbox and uses connectors registered in your **claude.ai account**, not local CLI config. A claude.ai custom connector accepts only a URL — it cannot send a custom `Authorization` header — so it authenticates via the `?token=` query-param path on `/api/mcp`. In **claude.ai → Settings → Connectors → Add custom connector**, register:

```
https://<app>/api/mcp?token=<base64 user:pass>
```

- `<base64 user:pass>` is `base64(MCP_BASIC_USER:MCP_BASIC_PASS)` — the **same** encoded credential used after `Basic ` in the header (see path B and [remote-mcp-deployment.md](./design/remote-mcp-deployment.md)). There is no separate secret; the `?token=` path validates against the same `MCP_BASIC_*` env vars. When those are unset, both auth paths are disabled and a routine cannot authenticate.
- The token rides in the URL (may appear in logs) — acceptable for a single-user pool. Rotate by changing `MCP_BASIC_USER`/`MCP_BASIC_PASS` in Vercel and updating the connector URL.
- claude.ai connectors are proxied by Anthropic, so this works without allowlisting the app's host. Enable the connector for the routine in the routine's connector list.

**B. A home session (local CLI) — use Basic auth.** A pre-started session on a real machine registers the connector locally with HTTP Basic credentials:

```bash
claude mcp add --transport http ai-kanban-dispatch https://<app>/api/mcp \
  --header "Authorization: Basic <base64 user:pass>"
```

- `<base64 user:pass>` is `base64(MCP_BASIC_USER:MCP_BASIC_PASS)` — the Basic-auth gate on `/api/mcp`. (This local-CLI registration is **not** visible to a cloud routine — that is why path A exists.)

Either way, the five recurring tools appear under the `mcp__ai-kanban-dispatch__*` prefix, alongside the four card tools (nine total).

## 2. Create the scheduled routine

Create one scheduled routine (via the `/schedule` skill or the Claude routines UI) whose prompt runs the recurring-queue loop. The work is repo-less, so the routine's cloud sandbox (no local filesystem) is a non-issue — no repos need to be attached.

Routine prompt (points at the committed skill):

> Run the AI-Kanban recurring queue: follow the `run-recurring-queue` skill. Call `list_recurring_due`; for each due task, `start_recurring(id)`, optionally `list_recurring_runs(id)` to read recent run notes for continuity, carry out its `instruction`, then `complete_recurring(id, { note })` on success or `fail_recurring(id, { error })` on failure — carrying any state future runs need forward in the note. Skip any task whose claim returns an error. If nothing is due, exit.

Pick a cadence at or above the 1-hour floor (see caveats). Hourly is a reasonable default and aligns with the `hourly` schedule preset.

## 3. The processing loop (what the routine does each wake)

1. `list_recurring_due()` → `{ tasks }` (already filtered to enabled + idle + due).
2. For each task: `start_recurring(id)` (atomic claim). On an error result, read `structuredContent.code` and skip — `ERR_ALREADY_RUNNING`, `ERR_NOT_DUE`, or `ERR_NOT_FOUND`.
3. Optionally `list_recurring_runs(id)` when the instruction builds on earlier runs — latest run notes, newest first (default 5, max 20) — then follow the task's `instruction`.
4. `complete_recurring(id, { note })` on success, or `fail_recurring(id, { error })` on failure.
5. Continue until the list is exhausted.

Tool result shape: success = `{ structuredContent, content }`; readable error = `{ isError: true, structuredContent: { code, message }, content }`.

## 4. Caveats to honor

- **~1-hour cron floor.** Routines cannot run more often than hourly; finer scheduling is impossible. The `hourly` preset (`everyHours: 1`) is the practical minimum interval for a recurring task.
- **Per-account run cap + subscription usage.** Each routine wake draws the account's daily routine run cap and subscription usage. Keep the cadence as coarse as the work allows.
- **A green run is NOT task success.** The routine exiting cleanly only means the session ran — it says nothing about whether the instructions succeeded. The skill MUST call `complete_recurring` / `fail_recurring` explicitly; the server only records the outcome it is told.
- **No trigger idempotency.** A duplicate or re-fired routine run is made safe by the atomic `start_recurring` claim: the duplicate loses the claim (`ERR_ALREADY_RUNNING`) and skips the task. The claim is the dedup guarantee — do not add a second one.
- **Failure is terminal until reset.** `fail_recurring` parks a task in the `failed` state; it is no longer due and the routine will not pick it up again. An operator reviews the failure (and its run-history) on the Recurring surface, records a fix note, and resets it back to due.
