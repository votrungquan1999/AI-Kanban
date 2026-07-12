# 10 — Clarifying Questions & Resolutions

The direction converged through several rounds. This records the **final resolved model**
and the key corrections that got us there.

## The resolved model — three tiers (see [20](./20-zoom-1-shape.md))

- **Tier 1 — implementation decisions → card `decisions[]`.** Fine-grained, made during a
  build, logged **live**, superseded (not edited) when overridden. Source of truth,
  integratable into an external search/RAG platform later. Serves **#1**.
- **Tier 2 — project-level ADRs → repo `docs/adr/`.** Coarse-grained architecture decisions
  ("why MongoDB"). Committed, immutable, reference-only. Part of **#2**.
- **Spec → repo `docs/features/<slug>/spec.md`.** Living feature behavior. Repo file only,
  not on the card. Part of **#2**.
- **`tmp/DECISIONS.md`** stays as-is: working review scratch, ephemeral.

## Corrections that shaped it (what we ruled out)

- **"Card is source of truth" — but only for decisions + progress, not the spec.** The spec
  is a repo file, deliberately *not* mirrored on the card.
- **Card decisions ≠ ADRs.** Implementation decisions (small, per-build) live on the card;
  ADRs (high-level, project-level) are a separate artifact in the repo. Do **not**
  auto-promote tmp/card decisions into ADRs.
- **Keep the tmp decision log.** The skill still writes decisions to `tmp/DECISIONS.md` for
  review, exactly as today — the card `decisions[]` is an *additional*, durable sink, not a
  replacement.
- **No `search_cards` endpoint in v1.** Cross-repo/board-wide search was considered, but the
  chosen path is: card `decisions[]` is structured data → integrate into an external search
  platform / RAG later. Recall v1 is a skill over the card + repo grep.

## Enforcement decision

**Skill phase + reminder hook.** Feature-dev skills write the artifacts as they work
(decisions live to the card, spec on completion, ADR when architectural); a lightweight hook
**nudges** (never blocks) if a feature-dev skill ran but the spec wasn't updated. Rule-only
was rejected (agents skip it); hard-block was rejected (fires on trivial edits).

## Session scope

Brainstorm/design only — no code. Produce this doc; implement later on approval.

## Still-open specifics (for the implementation plan to resolve)

- **ADR authoring trigger** — auto-draft an ADR when a project-level decision is detected,
  or only prompt the user to write one? (Auto-draft risks noise; prompt risks being
  skipped.) Leaning: prompt + reminder hook.
- **Feature slug identity across updates** — confirm `<slug>` = the orchestrated task
  identifier and that an update reuses the same `docs/features/<slug>/` folder.
- **Decision `why` — required or optional?** Required improves recall but adds mid-build
  friction. Leaning: optional, encouraged by the skill prompt.
- **Hook scope** — nudge only on a missing `spec.md`, or also when an architectural
  decision was made but no ADR written (harder to detect)?

→ Next: [20-zoom-1-shape](./20-zoom-1-shape.md)
