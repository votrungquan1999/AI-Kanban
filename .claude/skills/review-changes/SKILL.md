---
name: review-changes
description: Senior engineer code review analyzing diffs for correctness, security, architecture and design fit, performance, edge cases, and best practices with severity-based findings, each labeled by origin (introduced by this change vs pre-existing). Scales its own depth to the size and risk of the diff, so a small change costs a fraction of a large one. Use when reviewing code, checking changes, or when user says "review my changes", "code review", "review this diff", or "check my code".
---

# Review Changes

You are the **orchestrator** for an autonomous code review, running in the main session so you can see the conversation — the target to review, the base, and any context the user gave. You are a **thin coordinator**: resolve what to review, then spawn a sub-agent for every phase — holistic, each lens, each verifier, and the merge. You never read a diff or a lens file yourself; you spawn, collect short summaries, route, and relay. The heavy reading stays in the sub-agents, out of the session's context.

This is a lightweight **review → verify → merge** pipeline, not a stateful workflow: no per-phase user gates — spawn, collect, verify, merge, done. How wide the review phase spreads is set by **Review Depth** below, which is what keeps a small diff from costing what a large one does.

## Step 0 — Work in the right repo, against a fresh base

Resolve the target from the conversation, then get these right — each is a common way the review goes wrong. Pass the repo dir and `$BASE` to every sub-agent.

- **No target.** If nothing resolves — no PR/MR, no branch, no uncommitted work — do NOT review whatever happens to be checked out. Ask which target.
- **Wrong repo.** Often not the current dir (you may be in `~/git-repos/personal` while the target is `quant-trading/`). Infer it from the conversation (files named, IDE selection); if the current dir isn't a git repo and the target is unclear, ask.
- **PR/MR reviewed in place.** Never review a PR in the user's working tree. Check it out in its own worktree (`../<repo>-pr-<num>` at `origin/<head>`; refresh from remote if it already exists, and if `pull --rebase` conflicts, stop and ask). Run every phase from there, set `BASE=origin/<base>`, resolve `<ws>` under it, and surface the worktree path in the report. Platform from the remote: `github.com`→`gh`, `gitlab`→`glab`.
- **Stale base.** Diff against the remote default (`git fetch origin`; `origin/HEAD` → `origin/main`/`master`), not a local ref that's behind. Use the base the user named if they gave one; `HEAD~1` only when there's no base branch at all (say so).
- **Wrong scope.** branch/PR → committed since `$BASE`; uncommitted → also `git status --short`; ambiguous → committed-since-base.

## Pipeline

Order and who-runs-each — the source of truth for the *flow*. Models live in **Model Selection**, paths in **Workspace**, per-phase detail in the `nodes/` files; point every lens/verifier subagent at its matching node file.

1. **holistic** — sub-agent → `HOLISTIC.md` + eligibility verdict + **review depth** + per-lens applicability
2. **gate** — depth decides *how many agents* carry the lenses; applicability decides *which lenses* run (correctness is the floor)
3. **lenses** — parallel subagents, grouped per depth: correctness / security / architecture / quality / tests / performance
4. **gate** — which findings did the lenses report as `Needs verification: yes`, and how many batches does the depth allow?
5. **verify** flagged findings — parallel subagents
6. **merge** — sub-agent → `<ws>/review-changes.md`

## Review Depth (the main cost lever)

Every sub-agent pays the same fixed overhead before it reads any diff — its own system prompt and tool schemas, the repo's convention files, its node file, `HOLISTIC.md`. A six-lens fan-out plus verifiers plus merge is 10–12 agents, so an unconditional fan-out charges a 40-line diff nearly what it charges a 3000-line one. Holistic measures the diff and returns a **depth**; you route on it.

Applicability and depth are independent and both bind: **a lens holistic marked `no` never runs at any depth**, and a lens it marked `yes` always gets reviewed — depth only changes how many agents share the work.

- **`compact`** → **one** grouped agent (`node-lens-grouped.md`) covering *every* applicable lens in a single pass → `LENS_grouped-all.md`. Holistic only returns this depth when security and architecture both came back `no`, so this group is always mechanical lenses only.
- **`grouped`** → **up to two** grouped agents, spawned in one message:
  - `mechanical` — correctness / quality / tests / performance, intersected with what holistic marked `yes` → `LENS_grouped-mechanical.md`
  - `deep` — security / architecture, intersected with what holistic marked `yes`; **skip this agent entirely if neither fired** → `LENS_grouped-deep.md`
- **`fan-out`** → **one agent per applicable lens**, as before → `LENS_<name>.md` each.

Security and architecture never share an agent with the mechanical lenses. They read across files and carry the judgment calls, so they get their own agent and their own model at every depth that runs them — grouping cuts agent count, never the depth of a lens.

**Route on holistic's depth; do not re-derive it.** It measured the diff and applied the escalation rules. Upgrade a depth only if you know something it could not — the user asked for a thorough review, or named a risk in the conversation. Never downgrade one to save tokens: holistic already made that trade with the diff in front of it.

## Orchestrator Rules

You (the main session):
- **Resolve the target** from the conversation (Step 0) — the one thing only you can see. Pass the repo dir, `$BASE`, and `<ws>` into every sub-agent prompt.
- **Spawn a holistic sub-agent** (strong model) — it reads the whole diff, writes `HOLISTIC.md`, and returns the eligibility verdict, the review depth, and the lens applicability you gate on. It produces the shared framing every lens depends on.
- **Spawn lens sub-agents in parallel** (a single message with multiple `Agent` calls) so they run concurrently — one per lens, or one per group, per the depth.
- **Spawn verifier sub-agents** only for findings a lens reported `Needs verification: yes`, up to the depth's batch cap — they resolve the flagged uncertainty against the real code. Findings the lens confirmed itself are trusted and skip this step.
- **Spawn a merge sub-agent** — it reads every `LENS_*.md` and `VERDICT_*.md`, applies verdicts, scores, filters, dedupes, and writes the final report.
- **Say what the review cost in coverage.** Name the depth and the skipped lenses when you relay the result. A `compact` review that reads like a full one is the failure mode this ladder introduces.

You MUST NOT:
- Read the raw git diff or a `LENS_*.md` yourself, or output diff/command output to the user
- **Do the review by hand.** Every phase is a sub-agent. If a phase can't run — no target resolved, a sub-agent bailed — fix the input and re-spawn; never substitute your own inline review for the pipeline. A bailed phase means re-spawn, not freelance.

## Model Selection (cost lever)

The `Agent` tool accepts a per-call `model` parameter (`"haiku" | "sonnet" | "opus"`).
- **holistic** → omit `model` (session default / strongest). It sets the framing every lens trusts *and* decides the depth every later phase costs — the one agent never worth discounting.
- **mechanical lenses** (correctness, quality, tests, performance — grouped or individual) → `model: "sonnet"`. Focused work; performance traces magnitude across files, but the judgment stays mechanical.
- **security, architecture** (the `deep` group, or individual at `fan-out`) → omit `model`. Both read across files — data flow, route tables, schema, the layers above and below — and both produce judgment calls. Cheap security review gives false confidence; a discounted architecture lens degrades into style nits, precisely the failure it exists to fix. **Depth never downgrades these two** — that is why they get their own agent instead of joining the mechanical group.
- **verifiers** → `model: "sonnet"` by default, but **omit `model` for any batch containing a security finding** — verifying a security claim cheaply gives the same false confidence as reviewing it cheaply.
- **merge** → `model: "sonnet"` at `compact` depth (one lens file, few findings, little to reconcile); omit `model` at `grouped` and `fan-out`, where it is doing real scoring and dedupe across several sources.

## Workspace

Establish `<ws>` = `./tmp/<identifier>/` first (identifier = branch name, PR/MR number, or a short slug). If `<ws>` already holds an unrelated review's artifacts, STOP and ask. Every sub-agent gets `<ws>`: intermediates go under `<ws>/review-changes/`, the final report to `<ws>/review-changes.md`. Node files write `./tmp/review-changes/…` as shorthand for `<ws>/review-changes/…`.

Holistic captures the diff once to `<ws>/review-changes/DIFF.patch`; lenses and verifiers read that file rather than each rebuilding the diff. Tell every sub-agent it exists.

**Spawning convention (applies to every phase):** point the sub-agent at its `nodes/*.md` — the real instructions live there, don't restate them — and give it the repo dir, `$BASE`, and `<ws>`. Models per phase are in Model Selection above. A grouped lens agent additionally gets its **lens list** and its **output filename**, since one node file serves every group.

## Phase 1: Holistic (sub-agent)

Spawn `node-holistic.md`. It reads the diff, writes `HOLISTIC.md` (shared context for the lenses), and returns an **eligibility verdict**, a **`## Review Depth`** line, and its **`## Lens Applicability`** block — a `yes`/`no` and a reason for each of the six lenses. Gate the pipeline on the eligibility verdict; hold the other two for the Phase 2 gate.
- **stop** (no changes) → relay and finish.
- **single-inline-pass** (trivial diff) → it already wrote the final `<ws>/review-changes.md`; relay its summary and finish.
- **proceed** → continue.

## Phase 2: Depth + lens gate

Two verdicts from holistic combine here. **Applicability** decides which lenses run: **correctness** is the floor and always runs; **security, architecture, quality, tests, performance** each run only on a `yes`. **Depth** decides how many agents carry them, per the routing in **Review Depth** above. Route off holistic's verdicts rather than re-deriving either.

State the depth, which lenses you are running, how they are grouped, and the reason for each skip, before spawning. Both are visible costs: a skipped lens is a gap in coverage, and a cheaper depth is a gap in how independently each lens was applied.

## Phase 3: Lenses (parallel)

Spawn the agents the depth calls for in **one message**.

- **`compact`** → one agent on `node-lens-grouped.md`, given the full applicable lens list and the output path `LENS_grouped-all.md`.
- **`grouped`** → the `mechanical` agent, plus the `deep` agent if security or architecture fired, both on `node-lens-grouped.md` with their own lens lists and output paths.
- **`fan-out`** → one agent per applicable lens on its own `node-lens-<name>.md`, writing `LENS_<name>.md`.

Every lens agent also reads `lens-common.md`; a grouped agent reads the `node-lens-<name>.md` of each lens it owns. Each reports back: finding count (per lens when grouped), top severity, and for every `Needs verification: yes` finding a one-line entry (lens, `file:line`, severity, what to check) — so you can route it without opening the file.

## Phase 4: Verification (parallel, capped by depth)

Lenses are **trusted by default**; only their `Needs verification: yes` findings get checked. Triage from what the lenses reported back — do **not** open `LENS_*.md`. If none were flagged, skip to Phase 5.

Otherwise batch the flagged findings **2–4 by shared file/module** and spawn `node-verify.md` in **one message**; each writes `VERDICT_<batch>.md` and reports CONFIRMED / REFUTED / UNCERTAIN. Cap the batches by depth, and when a cap bites, spend it on what costs most to get wrong:

- **`compact`** → at most **1** batch. Verify flagged **MUST FIX** findings first, then SHOULD FIX if room remains; never spend the batch on a NIT.
- **`grouped`** → at most **2** batches, same priority order.
- **`fan-out`** → uncapped; verify every flagged finding.

A flagged finding left unverified is **not** promoted to trusted — merge scores it as UNCERTAIN and marks it "(unverified)". Tell the merge agent how many you left unchecked so it can report that honestly.

## Phase 5: Merge (sub-agent)

Spawn `node-merge.md` (model per depth — see **Model Selection**). It reads every `HOLISTIC.md` / `LENS_*.md` / `VERDICT_*.md`, applies verdicts, scores, filters, dedupes, writes the final `<ws>/review-changes.md`, and returns the recommendation, severity counts, and the origin split (how many findings this change introduced vs inherited). Relay the recommendation, the depth the review ran at, the origin split, and the report path; don't re-list findings inline.

## Related Skills

- `@test-quality-reviewer` — Detailed test quality analysis using 4 Pillars framework (the tests lens may defer to it)
- `@code-refactoring` — Structured refactoring suggestions
- `@commit-plan` — Organize reviewed changes into semantic commits
