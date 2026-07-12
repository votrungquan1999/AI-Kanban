# Brainstorm — Durable Decision-Recall + Living Spec (Three Tiers)

Makes the *why* behind feature work **durable and recallable**, split across **three tiers**
by granularity: fine-grained **implementation decisions on the card** (source of truth,
integratable), coarse-grained **project ADRs in the repo**, and a **living feature spec in
the repo**. So you can later ask "what did we do and why?" and get the answer without
re-reading code.

## Problem in one line

Today the reasoning trail (`DECISIONS.md`, plan, behavior-risks) lives in `./tmp/<id>/`,
which is **gitignored and deleted when the task ends** — so the *why* evaporates, and the
kanban card keeps only terse standup notes. See [00-problem-and-context](./00-problem-and-context.md).

## Read in order

1. [00-problem-and-context](./00-problem-and-context.md) — problem statement, verified
   current state of both systems, where intent leaks out today.
2. [10-clarifying-questions](./10-clarifying-questions.md) — the resolved three-tier model,
   the corrections that got us there, and the still-open specifics.
3. [20-zoom-1-shape](./20-zoom-1-shape.md) — widest view: the three tiers and the full
   artifact map.
4. [30-zoom-2-anatomy](./30-zoom-2-anatomy.md) — card `decisions[]` + the two tools
   (`append_decision`, `mark_decision_outdated`), repo ADR + spec, skill wiring, the hook,
   the recall skill.
5. [50-research-and-upgrades](./50-research-and-upgrades.md) — what established practice
   (ADR/MADR/RFD, agent-memory research, spec-driven dev) says; read its top alignment note
   first for what applies vs. what's out of scope for v1.

Implementation planning lives in the orchestrated-feature-dev run's own artifacts, not here.

## One-paragraph summary

Three artifacts need to outlive the run, at three granularities. **Implementation
decisions** (fine-grained, per-build) are logged **live** onto the card in a new
`decisions[]` field via an **`append_decision`** tool. Entries are independent (append never
overrides a prior one); *separately*, when a decision genuinely replaces a specific earlier
one, the agent explicitly marks **that** entry `outdated` (never edits it) — the card stays
canonical and integratable. **Project-level ADRs** (coarse-grained, "why MongoDB") are committed to
`docs/adr/` in the repo, immutable. The **living feature spec** is committed to
`docs/features/<slug>/spec.md`. `orchestrated-feature-dev` gets the wiring; a **recall
skill** answers "what did we do / why" over the card + repo docs; a **reminder hook** nudges
if a feature-dev skill ran but the spec wasn't updated. Write-always, read-on-demand — RAG
comes later.

## Decisions locked (this session)

- **Three tiers:** implementation decisions → card `decisions[]`; project ADRs →
  `docs/adr/`; feature spec → `docs/features/<slug>/spec.md`.
- **Card holds decisions + progress only** — *not* the spec. Decisions logged live, with
  supersession.
- **No `search_cards` / no spec-on-card in v1** — the card `decisions[]` is the integration
  point; external search / RAG is later.
- **Enforcement:** skill phase writes the artifacts + a reminder hook nudges.
- **This session:** design/brainstorm only, no code.

## Status

Brainstorm converged on the three-tier model — ready for review. Tracked as AI-Kanban card
**#41**. Research ([50](./50-research-and-upgrades.md)) still applies to the parts it
touches (supersession, capture-gate against hoarding, spec-anchored, MADR-lean ADR fields);
the parts about a spec-on-card / `search_cards` hybrid are **out of scope for v1** per the
resolved model — see the note at the top of [50](./50-research-and-upgrades.md). Next step
(on approval): run `@create-implementation-plan` on **Slice 1** (card `decisions[]` +
`append_decision`).
