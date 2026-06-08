# Recurring-Task Routine Setup

How to wire a Claude cloud **routine** (scheduled cron run) to process AI-Kanban's recurring-task queue. The routine periodically lists due recurring tasks over the deployed MCP connector, executes each task's instruction, and reports the result back. This is the scheduler half of the Recurring Tasks feature — the app code never requires a live routine to run or to pass CI.

Related: the committed skill [`.claude/skills/run-recurring-queue/SKILL.md`](../.claude/skills/run-recurring-queue/SKILL.md) (the loop the routine runs); the connector deployment doc [`docs/design/remote-mcp-deployment.md`](./design/remote-mcp-deployment.md); the design rationale in [`docs/brainstorm/next-feature/`](./brainstorm/next-feature/README.md).

## 1. Register the MCP connector (one-time)

The recurring queue tools (`list_recurring_due`, `start_recurring`, `complete_recurring`, `fail_recurring`) register through the **same** `ai-kanban-dispatch` connector as the existing card dispatch tools — there is no separate connector. There are two registration paths depending on **where the connector lives**, because they authenticate differently:

**A. A scheduled routine (cloud) — use the URL `?token=` path.** A routine runs in Claude's cloud sandbox and uses connectors registered in your **claude.ai account**, not local CLI config. A claude.ai custom connector accepts only a URL — it cannot send a custom `Authorization` header — so it authenticates via the `?token=` query-param path on `/api/mcp`. In **claude.ai → Settings → Connectors → Add custom connector**, register:

```
https://<app>/api/mcp?token=<MCP_URL_TOKEN>
```

- `<MCP_URL_TOKEN>` is the value of the `MCP_URL_TOKEN` env var set in Vercel — the additive token auth path gating `/api/mcp` (see [remote-mcp-deployment.md](./design/remote-mcp-deployment.md)). When that env var is unset, the token path is disabled and a routine cannot authenticate.
- The token rides in the URL (may appear in logs) — acceptable for a single-user pool. Rotate by changing `MCP_URL_TOKEN` in Vercel and updating the connector URL.
- claude.ai connectors are proxied by Anthropic, so this works without allowlisting the app's host. Enable the connector for the routine in the routine's connector list.

**B. A home session (local CLI) — use Basic auth.** A pre-started session on a real machine registers the connector locally with HTTP Basic credentials:

```bash
claude mcp add --transport http ai-kanban-dispatch https://<app>/api/mcp \
  --header "Authorization: Basic <base64 user:pass>"
```

- `<base64 user:pass>` is `base64(MCP_BASIC_USER:MCP_BASIC_PASS)` — the Basic-auth gate on `/api/mcp`. (This local-CLI registration is **not** visible to a cloud routine — that is why path A exists.)

Either way, the four recurring tools appear under the `mcp__ai-kanban-dispatch__*` prefix, alongside the four card tools (eight total).

## 2. Create the scheduled routine

Create one scheduled routine (via the `/schedule` skill or the Claude routines UI) whose prompt runs the recurring-queue loop. The work is repo-less, so the routine's cloud sandbox (no local filesystem) is a non-issue — no repos need to be attached.

Routine prompt (points at the committed skill):

> Run the AI-Kanban recurring queue: follow the `run-recurring-queue` skill. Call `list_recurring_due`; for each due task, `start_recurring(id)`, carry out its `instruction`, then `complete_recurring(id, { note })` on success or `fail_recurring(id, { error })` on failure. Skip any task whose claim returns an error. If nothing is due, exit.

Pick a cadence at or above the 1-hour floor (see caveats). Hourly is a reasonable default and aligns with the `hourly` schedule preset.

## 3. The processing loop (what the routine does each wake)

1. `list_recurring_due()` → `{ tasks }` (already filtered to enabled + idle + due).
2. For each task: `start_recurring(id)` (atomic claim). On an error result, read `structuredContent.code` and skip — `ERR_ALREADY_RUNNING`, `ERR_NOT_DUE`, or `ERR_NOT_FOUND`.
3. Follow the task's `instruction`.
4. `complete_recurring(id, { note })` on success, or `fail_recurring(id, { error })` on failure.
5. Continue until the list is exhausted.

Tool result shape: success = `{ structuredContent, content }`; readable error = `{ isError: true, structuredContent: { code, message }, content }`.

## 4. Caveats to honor

- **~1-hour cron floor.** Routines cannot run more often than hourly; finer scheduling is impossible. The `hourly` preset (`everyHours: 1`) is the practical minimum interval for a recurring task.
- **Per-account run cap + subscription usage.** Each routine wake draws the account's daily routine run cap and subscription usage. Keep the cadence as coarse as the work allows.
- **A green run is NOT task success.** The routine exiting cleanly only means the session ran — it says nothing about whether the instructions succeeded. The skill MUST call `complete_recurring` / `fail_recurring` explicitly; the server only records the outcome it is told.
- **No trigger idempotency.** A duplicate or re-fired routine run is made safe by the atomic `start_recurring` claim: the duplicate loses the claim (`ERR_ALREADY_RUNNING`) and skips the task. The claim is the dedup guarantee — do not add a second one.
- **Failure is terminal until reset.** `fail_recurring` parks a task in the `failed` state; it is no longer due and the routine will not pick it up again. An operator reviews the failure (and its run-history) on the Recurring surface, records a fix note, and resets it back to due.
