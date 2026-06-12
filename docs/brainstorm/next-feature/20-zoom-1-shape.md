# Zoom 1 — Widest View: the shape of "recurring work"

> Parent: [00-problem](./00-problem-and-context.md) · Prev:
> [10-clarifying-questions](./10-clarifying-questions.md) · Next:
> [30-zoom-2-anatomy](./30-zoom-2-anatomy.md).

## The widest framing

> *How does **standing, repeating work** enter an AI-orchestration system and get
> **executed unattended**, when (a) we want the **scheduler to be Claude itself**,
> (b) the work is **repo-less**, and (c) we already own a **board + audit log + HTTP
> MCP connector** but the **local runner is billing-blocked**?*

Three nouns fall out of that question, and the whole design is just deciding what
each one is:

1. **The definition** — where a recurring task is authored & stored, and what state it carries.
2. **The trigger** — what decides a task is *due* and *not yet done* (the "scheduler").
3. **The executor** — what actually follows the instruction and reports back.

The board feature answered these for *one-shot* work (human authors a card → human
copies a dispatch command → a session executes). Recurring work needs all three to
run **without a human in the trigger loop**.

## Alternatives at this layer

### Alt A — Separate surface + Claude cloud routine + queue-level MCP *(CHOSEN)*

A standalone **Recurring Tasks** surface stores definitions. A **Claude routine**
(cloud cron) wakes on a schedule, calls **new queue-level MCP tools** over the
existing `/api/mcp` connector to **list due tasks**, executes each instruction
**in the routine's own cloud session**, and calls back to **mark done + log the run**.

```
 Recurring surface (Vercel UI)        Claude routine (cloud cron, every ~1h)
        │ author/enable                       │ wake
        ▼                                      ▼
   recurring_tasks (Mongo) ◀──MCP connector── list_recurring_due()
        ▲                                      │ for each: follow instruction
        │ run-history                          ▼
   recurring_runs (Mongo) ◀──MCP connector── complete_recurring(id, outcome)
```

**Pros:** matches every answer (separate surface, execute-directly, repo-less,
Claude-native scheduler); **unblocked by the billing gate** (no local FS, no
worktree, no Team-Premium local sessions); reuses the deployed HTTP connector +
audit pattern; routine gives a **per-run reviewable claude.ai URL** for free.
**Cons:** routine cron floor is **~1 hour** (fine for recurring, not for real-time);
draws per-account routine run cap + subscription usage; requires registering the
connector + a tiny "run-the-recurring-queue" skill/prompt for the routine.

**Principles:** Claude owns *when* + *execute*; our app owns *what* + *state* +
*audit*. Repo-less is the wedge that makes the cloud scheduler legal here.

### Alt B — Recurring *definitions* that seed board cards (the old design)

When due, a definition creates a normal Todo **card** on the board; the existing
dispatch flow takes over.

**Pros:** reuses the entire board + dispatch pipeline; one execution path.
**Cons:** **rejected by Q5** ("separated from the board", "execute directly"). Also
re-enters the local-runner/billing-gated path, since board cards are designed for
local worktree execution. Keeps recurring work tangled with one-shot work.

### Alt C — Custom Node cron runner (our own scheduler)

A small always-on Node process does the cron + calls the service directly.

**Pros:** full control, sub-hour cadence, no routine caps.
**Cons:** **rejected by Q1** ("scheduler **on Claude**"); needs an always-on machine
(the very thing routines remove); duplicates scheduling Claude already offers; the
research ([claude-scheduling-capabilities](../../research/claude-scheduling-capabilities.md))
only favored a custom runner for the **local-first per-card** model, which we've
explicitly stepped away from for recurring work.

## Decision

**Go with Alt A.** It is the only option consistent with all four answers and is the
one the billing gate does **not** block. B and C are kept as recorded rejections: B
is the right shape only if we later want recurring work to flow through human review
on the board; C is the fallback if Claude routine limits (cadence/caps) prove too
tight in practice.

## Assumptions to validate deeper (carried to [zoom-2](./30-zoom-2-anatomy.md))

- A Claude **routine** can call our **HTTP MCP connector** and we can expose
  **queue-level** tools (`list_recurring_due` / `start` / `complete`) — research says
  yes (connector traffic is proxied by Anthropic), but the queue-level tools are
  **new** (today's tools are all single-`id`).
- A **~1 hour** minimum cadence is acceptable for "recurring" semantics.
- "Repo-less" holds for the tasks the user actually wants (summaries/checks/etc.).
- Run-history can reuse the `card_events`/`emit*` audit pattern with a
  recurring-flavored event or a sibling `recurring_runs` collection.
