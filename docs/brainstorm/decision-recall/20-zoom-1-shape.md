# 20 — Zoom 1: The Shape (Three Tiers)

Widest view. The core insight: the "why" behind work lives at **three different
granularities**, and each wants a different home. Conflating them was the mistake; keeping
them separate is the design.

## The three tiers

- **Tier 1 — Implementation decisions** (fine-grained). Small implementation-detail choices
  made *during a build*: "used a touch-basis fill, not close", "gated on the intrabar
  high/low", "dedupe on append". Many per feature. → **Card `decisions[]`** (source of
  truth, integratable).
- **Tier 2 — ADRs** (coarse-grained, **project-level**). High-level architecture decisions
  explaining why the *project* is the way it is: "why MongoDB", "why event-sourced board
  state". Few, deliberate, long-lived. → **Repo `docs/adr/NNNN-*.md`** (committed,
  reference).
- **The spec** (feature behavior, not a decision). What a feature *does* / how it behaves.
  One living document per feature. → **Repo `docs/features/<slug>/spec.md`**.

This mirrors the established **decision-log → ADR → RFC/spec** granularity ladder (see
[50](./50-research-and-upgrades.md)): a running fine-grained log, a curated architecture
record, and a behavior spec are genuinely different artifacts.

## Where each artifact lives (the full map)

- **`tmp/<id>/DECISIONS.md`** — working decision scratch during a build. **Unchanged:**
  review-only, ephemeral, deleted at task end.
- **Card `decisions[]`** *(NEW)* — Tier 1. The skill **also** appends here, **live**, on
  each new decision (each entry independent — appending never overrides a prior one).
  Separately, when a new decision genuinely replaces a *specific* earlier one, the agent
  explicitly marks that one `outdated`. This is the durable, queryable record — the source
  of truth that a future search/RAG platform integrates.
- **Card `progress[]`** — the work trail. **Unchanged.**
- **Repo `docs/adr/NNNN-*.md`** *(NEW)* — Tier 2. Project-level ADRs, immutable + supersede.
- **Repo `docs/features/<slug>/spec.md`** *(NEW)* — the living feature spec.

## Which ask each tier serves

- **#1 "trace what we did + ask why, easily"** → **card `decisions[]` + `progress[]`**.
  Structured in Mongo, so it's the clean integration point for external search/RAG.
- **#2 "ADR + spec in the repo for reference"** → **`docs/adr/` + `docs/features/*/spec.md`**,
  committed, read-on-demand, RAG-later.

## Read-on-demand, write-always

Both asks share one principle the research strongly backs: **write the record always,
read it on demand.** Nothing here is auto-loaded into every session (that *reduces* model
adherence past ~200 lines and pollutes context). The card is queried when you ask; the repo
docs are grepped/RAG'd when referenced.

## What this shape deliberately drops (vs. the earlier draft)

- **No `spec` field on the card** — the spec is a repo file only (your call: "the spec is a
  file in the repo, not on the card").
- **No `search_cards` MCP endpoint in v1** — the card's `decisions[]` is the integration
  point; external search / RAG comes later. Recall v1 is a skill over the card + repo docs.
- **No auto-promotion of tmp decisions into ADRs** — implementation decisions (Tier 1) are
  not ADRs (Tier 2); the tmp log stays review-only.

→ Next: [30-zoom-2-anatomy](./30-zoom-2-anatomy.md)
