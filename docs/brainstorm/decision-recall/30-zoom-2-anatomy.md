# 30 — Zoom 2: Anatomy

The concrete pieces of the three-tier model ([20](./20-zoom-1-shape.md)). Shapes are
illustrative, not final signatures.

## Tier 1 — Card `decisions[]` (implementation decisions, source of truth)

One new field on `CardDocument` (`src/cards/card.type.ts`), with a `Document` (BSON `Date`)
and client (`ISO string`) variant, **absent-tolerant** on legacy docs (mapper → `[]`, same
pattern as `progress`/`tags`).

```ts
/** Lifecycle of a recorded implementation decision. */
export enum DecisionStatus {
  Active = "active",
  Outdated = "outdated", // superseded by a later decision
}

/** One implementation decision recorded on a card. */
export interface DecisionEntry {
  at: Date;
  decision: string;            // what was decided, one line
  why?: string;                // short rationale (optional, but encouraged)
  status: DecisionStatus;      // active | outdated
  supersededByIndex?: number;  // index of the entry that overrode this one
}
```

**Behavior — two distinct, independent operations:**

- **Append (the common case).** During a build, each new implementation decision is appended
  as its own `active` entry — *in addition to* the existing `tmp/DECISIONS.md` review scratch
  (unchanged). **Appending does NOT touch any prior entry.** Most decisions are independent;
  they simply accumulate. There is no "newest wins."
- **Mark-outdated (the occasional case).** *Separately and explicitly*, when the agent
  recognizes that a decision **overrides a specific earlier one**, it flips **that particular**
  prior entry to `outdated`, optionally linking the entry that replaced it via
  `supersededByIndex`. The agent chooses *whether* this applies and *which* entry it targets —
  it is never automatic, and it can happen at append time or later (even retroactively).
- The original text is never rewritten — you can always see what was believed and when
  (immutability; see [50](./50-research-and-upgrades.md)).

### MCP tools (beside `append_progress` in `src/mcp/dispatch-tools.ts` + `dispatch-server.ts`)

- **`append_decision(id, { decision, why? })`** — appends a new `active` entry. Never mutates
  prior entries. Bumps `updatedAt` (keeps the card warm, like `append_progress`).
- **`mark_decision_outdated(id, index, { supersededByIndex? })`** — flips the entry at `index`
  to `outdated`, optionally pointing at the entry that replaced it. A separate, explicit call.
- Overriding a past decision is therefore **two calls** when it happens: `append_decision`
  (the new one) **then** `mark_decision_outdated` (the specific old one). A plain new decision
  is just `append_decision`.
- `get_card_context(id)` returns `decisions[]` for free once the type + mapper carry it — no
  new read tool needed.

**No `search_cards` in v1.** The card's `decisions[]` is structured Mongo data — the
integration point for an external search/RAG platform later. Recall v1 is a skill over
`get_card_context` + repo grep (see §Recall).

## Tier 2 — Repo `docs/adr/` (project-level ADRs)

Classic ADR convention — **not** on the card, **not** generated from Tier-1 decisions.

- Location: `docs/adr/NNNN-title-with-dashes.md`, sequential immutable numbers.
- Shape (MADR-lean): **Title · Status** (`accepted | superseded by ADR-NNNN`) · **Date** ·
  **Context** · **Decision** · **Consequences** (incl. negatives).
- Immutable: a reversal is a *new* ADR that supersedes the old one (flip old status, link
  both ways) — never an edit.
- Written when a **project-level architecture** decision is made ("why MongoDB", "why
  event-sourced board"), not per build. Reference-only, RAG-later.

## The spec — Repo `docs/features/<slug>/spec.md`

The living behavior spec for a feature. A repo file only (not on the card).

- Contents: what the feature does, its behaviors/ACs, and pointers to key files + PRs.
- **Spec-anchored:** updated on every change to the feature (new or update targets the same
  `<slug>` folder). Reference-only, RAG-later.
- `<slug>` = the orchestrated run's task identifier (already established in Phase 0), so an
  update reuses the same living spec.

## Skill wiring (all in AI-rules-repo)

- **orchestrated-feature-dev:**
  - *Decision logging is tied to `DECISIONS.md`.* The skill already appends to
    `<ws>/DECISIONS.md` "whenever any phase picks one of 2+ viable options." **Extend that
    exact rule:** every time `DECISIONS.md` is updated, mirror the same entry to the card via
    `append_decision`; if that entry supersedes a specific earlier one, also
    `mark_decision_outdated` on it. So the card stays a faithful copy of the review log, and
    the trigger is unambiguous — the `DECISIONS.md` write *is* the trigger.
  - *At completion (Phase 6):* write/update `docs/features/<slug>/spec.md`.
  - *When a project-level architecture decision surfaces* (often in research/plan): record a
    `docs/adr/NNNN-*.md`. (These are rarer and more deliberate than Tier-1 decisions.)
- **feature-development-workflow** (lighter skill): same three habits, scaled down —
  `append_decision` on real choices, update `spec.md` on completion, ADR when architectural.

## Reminder hook (the "always" nudge)

Lightweight hook (Stop/SubagentStop) that **nudges, never blocks**, when a feature-dev skill
ran this session but the expected artifact wasn't written — e.g. code changed under a
feature but `docs/features/<slug>/spec.md` wasn't touched. Lives in the `kanban-track` hook
family already in `.ai-rules.json`. Detection: skill drops a sentinel the hook checks (more
robust than transcript-grepping) — decide in the plan.

## Recall skill — "what did we do / why"

New skill (AI-rules-repo). Given a topic:
1. Card side (#1): `list_cards`/`get_card_context` → surface `decisions[]` (active first,
   outdated shown as history) + `progress[]`.
2. Repo side (#2): grep `docs/features/*/spec.md` + `docs/adr/*` for the topic.
3. Present *what we did* (progress/spec) and *why* (decisions + ADRs), newest first.
RAG/embeddings deferred until volume justifies it.

→ Back to [README](./README.md) · research in [50-research-and-upgrades](./50-research-and-upgrades.md)
