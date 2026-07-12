# 00 — Problem & Context

## Problem statement

When the user later references past work — *"that thing we did with the staled-card
timer"* — the agent can reconstruct **what** changed (from git) but not **why**: which
alternatives were on the table, what was decided, what behavior risks were accepted or
deferred. The reasoning that produced the code is thrown away. The user wants that *why*
to be **recorded once and searchable later**, plus a **living feature spec** that stays
current as a feature is built or updated.

## Two asks, one machinery

- **Ask 1 — Back-track recorded decisions.** Persist the decision log so "why did we do
  X" is answerable later via search.
- **Ask 2 — Always write the latest feature spec.** Every feature dev (new or updated)
  should persist the current spec so the repo/board carries a living spec.

Both reduce to the same need: **make intent durable and searchable.** Ask 1 = durable
*decisions*; Ask 2 = durable *spec*.

## Verified current state

### orchestrated-feature-dev (AI-rules-repo) — rich reasoning, but ephemeral

The skill (`skills/claude-code/orchestrated-feature-dev/SKILL.md`) runs every phase in a
sub-agent and passes data through **state files in `<ws>` = `./tmp/<identifier>/`**:

- `DECISIONS.md` — running log: *"Whenever any phase faces 2+ viable options and picks
  one … append: chosen option, alternative(s), one-line why."* **Exactly the back-track
  data.**
- `RESEARCH_OUTPUT.md`, `BEHAVIOR_RISKS.md` (frozen), `IMPLEMENTATION_PROGRESS.md`,
  `implementation-plan.md`, `VALIDATION_*`.

But the skill explicitly says: **"`./tmp/` is gitignored; delete the folder when done."**
So the entire reasoning trail is **deleted at task end**. Git keeps the diff, never the
*why*.

### ai-kanban card (AI-Kanban) — durable, but thin on reasoning

`CardDocument` (`src/cards/card.type.ts`) is the durable, cross-repo unit of work:

- Has `progress: ProgressEntry[]` — but `ai-kanban-track-session` tells agents to keep
  these to **terse one-line standup notes**, *not* decisions.
- Has `description`, `tags`, `sessionId`, `workspacePath`, `nextAction`.
- **No `decisions` field. No `spec` field.**

Retrieval surface today: `get_card_context(id)` (one whole card) and `list_cards`.
**There is no full-text search over card content** — so "search for why we did X" has no
endpoint at all.

### The KB (ai-rules `kb capture`) — wrong tool

The KB is for **generalizable, reusable** knowledge (patterns, TILs), reviewed into a
canonical store. Per-feature decision logs are **specific to one piece of work**, not
reusable rules — so the KB is not the home for this.

## Where intent leaks out today

```
orchestrated-feature-dev run
  └─ ./tmp/<id>/DECISIONS.md  ← the "why"  ─┐
  └─ ./tmp/<id>/implementation-plan.md ← spec │  all deleted at task end
  └─ ./tmp/<id>/BEHAVIOR_RISKS.md      ← risk ┘
        │
        ▼ (only this survives)
  kanban card.progress[]  ← terse standup notes, no decisions, no spec
        │
        ▼
  git history            ← the "what" (diff), never the "why"
```

The gap is the arrow from the deleted tmp artifacts to something permanent. This design
fills it by routing decisions + spec onto the **card**.

→ Next: [10-clarifying-questions](./10-clarifying-questions.md)
