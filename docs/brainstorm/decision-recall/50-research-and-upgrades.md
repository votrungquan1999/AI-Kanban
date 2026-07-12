# 50 — Research & Upgrades (Established Practice)

Web research into how the industry records/recalls decisions and keeps living specs.
Sources at the bottom.

> **Alignment note (read first).** This brief predates the final **three-tier** model
> ([20](./20-zoom-1-shape.md)). What still applies: **immutability + supersession** (now the
> card `decisions[]` outdated flag *and* ADR supersession), the **capture gate against
> hoarding**, **spec-anchored** positioning, **MADR-lean ADR fields**, and "portable
> markdown / read-on-demand". What is **out of scope for v1**: a `spec` field on the card,
> the `search_cards` **hybrid/vector** endpoint, and **bitemporal** stamps — the resolved
> model keeps the spec as a repo file and defers cross-repo search to an external
> platform/RAG. Read the ideas below through that lens.

## The one-line takeaway

Two admitted gaps in the current tooling landscape line up *exactly* with our two asks —
so this isn't a me-too design:

- **Spec-driven-dev tools have no post-creation spec-evolution discipline.** GitHub Spec
  Kit / Amazon Kiro create a spec then let it drift (branch-scoped, discarded); only
  Tessl even attempts spec↔code sync, and it's beta. Our **card-as-living-spec with a
  mandatory update-on-change step** targets the acknowledged hole.
- **Agent-memory systems degrade badly when they hoard.** A cited study: add-everything →
  2,400 records → **13% accuracy**; selective → 248 records → **39%**. More memory made
  the agent *worse*. Our capture gate + pruning is the guardrail, not an afterthought.

## What established practice says

### Decision records (ADR / MADR / RFC / RFD)
- **MADR field set** is the mature template: *Context/problem · Decision drivers · Options
  considered (+pro/con each) · Decision outcome · Consequences (incl. negatives) ·
  Confirmation (how we verify code still honors it)*. Richer than our v1
  `{title, chosen, alternatives, why}`.
- **Immutability + supersession is the core discipline.** You never edit an accepted
  decision — you write a new one that *supersedes* it, link both ways, and flip the old
  status. This is what gives a record its "true as of this date" guarantee and stops the
  **stale-drift → lost-trust → abandonment** failure that kills most ADR efforts.
- **Capture at decision time, not retroactively** — retroactive records "have the form but
  not the substance" (alternatives forgotten, consequences rewritten as outcomes). A card
  is *already the live work item*, so it captures fresh — a structural advantage over
  doc-based ADRs.
- **Cross-repo search = the Backstage collator pattern.** A scheduled job indexes every
  repo's decision records into one search store keyed by tag/scope/status/date, and links
  each hit back to the owning service. This is precisely our `search_cards` intent.
- **Link decision → work explicitly** (Rust RFC's auto-created tracking issue). Our card
  already *is* both, but we should carry `linkedPRs` / commit refs on the decision.
- **Programmatic metadata index** (Oxide's `rfd.csv`): emit a machine-readable index
  (id, title, status, tags, date, superseded-by, linked-PRs) so bots/dashboards/"list all
  superseded decisions in scope X" are cheap.

### Agent memory & recall (2024–2026)
- **Hybrid retrieval is state of the art — never pure vector.** Zep/Graphiti fuses
  semantic embeddings + BM25 keyword + structured filters. Pure cosine causes
  "stale-but-similar poisoning" (surfaces plausible-but-wrong neighbors); keyword alone
  misses paraphrases. Do both + filters.
- **Bitemporal facts** (Graphiti): every entry carries *event time* (`decidedAt`) and
  *ingestion time* (`recordedAt`). Makes "what did we believe **at the time**" and
  supersession first-class queries — the sophisticated answer to "how is *latest*
  maintained across updates."
- **Recency decay + a freshness signal at retrieval.** Agents treat old memory as
  authoritative as new ("equal-confidence trap"). Multiply similarity by time decay and
  surface the age to the recall skill.
- **Retrieval precision decays with scale** — top-5 recall 94% @100 memories → 71% @10k.
  Cross-repo scale *will* hit this → pruning/archival of superseded entries is mandatory,
  not optional.
- **Devin's `(content, trigger)` pairs** — store a semantic *recall cue* with each
  decision ("when work touches the labeler's fill price…") so recall matches on triggers,
  not just body text. The most battle-tested production recall pattern.
- **Portable markdown is winning as the read surface** (AGENTS.md convergence, Linux
  Foundation). Keep the card as source of truth; treat per-repo `CLAUDE.md`/`AGENTS.md`
  as a **projection/cache** of it — write once, sync a compact excerpt down, respect the
  **~200-line adherence ceiling** (longer files *reduce* model adherence).

### Living specs
- **Adopt "spec-anchored" as the positioning** (Böckeler's spectrum: spec-first →
  spec-anchored → spec-as-source). Spec-anchored = spec maintained alongside code for the
  system's life, tests enforce alignment. The production sweet spot. (Avoid spec-as-source
  — LLM non-determinism makes "humans edit only the spec" hype today.)
- **Anti-staleness must be an executable link, not discipline** (Gojko Adzic, Specification
  by Example). Prose kept in sync "by discipline" always drifts; a spec wired to tests
  can't drift *silently* because a failing test flags it.

## Upgrades to our design (the deltas)

1. **Richer, MADR-shaped `DecisionEntry`** — extend v1 with `context`, `consequences`
   (must include negatives), and `confirmation` (how we'll know the code still honors it).
   Keep it lean — a few tight fields, not an 8-file sprawl.
2. **Immutability + supersession (highest-value delta).** Decisions are append-only and
   never edited; add `status: accepted | superseded`, plus `supersedes` / `supersededBy`
   card+entry links. A reversal writes a new entry and flips the old.
3. **Bitemporal stamps** — `decidedAt` + `recordedAt` on every decision and spec version.
   Gap between them flags retroactive (lower-trust) capture.
4. **`search_cards` = hybrid, phased.** v1: Mongo full-text (Atlas Search / `$text`) +
   structured filters (tag/scope/status/date) + **recency decay** + exclude-superseded by
   default. v2: add vector (Atlas Vector Search) for paraphrase recall. Never pure vector.
   Return a **freshness/age signal** in every hit.
5. **Capture gate + pruning (the critical guardrail).** Keep the skill's existing bar (log
   only 2+-viable-option, hard-to-reverse picks; skip forced moves). Archive/TTL
   superseded entries so cross-repo recall doesn't rot at 10k+.
6. **Recall cue per decision** (Devin pattern) — optional `recallCue` string; the recall
   skill matches triggers + hybrid search.
7. **Executable spec-anchoring** — tie each spec AC to the BDD scenarios the orchestrated
   workflow *already* generates; when a scenario fails or the card enters `need_review`,
   flag the spec `possibly-drifted`. This is the "living" mechanism, reusing what we build.
8. **Resolve the Ask-2 tension cleanly (tension A, upgraded).** Card = source of truth; the
   "file under the repo" is a **compact projection** — a synced `docs/features/<slug>.md`
   or an `AGENTS.md` excerpt — regenerated from the card, never hand-edited, kept under the
   ~200-line ceiling. This honors the literal Ask 2 *and* card-as-truth, and matches where
   the industry is converging.
9. **Lightweight multi-agent write governance** — since orchestrated runs have several
   sub-agents appending to one card: keep the `phase` stamp (already have it), dedupe on
   append, and flag when two phases assert contradictory decisions. Borrow the *principle*
   (attribution + conflict detection), not a heavy framework.

## Skeptical filter — what NOT to build (yet)
- **No knowledge graph in v1.** Bitemporal fields + `supersedes` links get ~80% of the
  value; a graph DB is high-maintenance. Defer.
- **No heavyweight memory framework** (Letta/Mem0/Cognee) as infra — borrow the *patterns*
  (three-tier taxonomy, hybrid search, bitemporal), not the stacks.
- **Not spec-as-source / not 8-files-per-feature.** Keep the card spec one lean,
  human-reviewable surface.

## Impact on the open specifics ([10](./10-clarifying-questions.md#still-open-specifics-for-the-implementation-plan-to-resolve))
- **Supersession over history array:** research favors **explicit supersession** (the
  card's `outdated` flag) over storing every full revision — it makes "latest" and "what we
  believed then" both queryable cheaply.
- **Search backend, when it comes:** phased hybrid — full-text + filters + recency first,
  vector later. Never pure vector. (Out of scope for v1; noted for the future search/RAG
  integration.)

## Sources
- ADR/MADR/RFD: [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) ·
  [MADR](https://adr.github.io/madr/) · [log4brains](https://github.com/thomvaill/log4brains) ·
  [Oxide RFD 1](https://oxide.computer/blog/rfd-1-requests-for-discussion) ·
  [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/) ·
  [Backstage ADR plugin](https://backstage.io/docs/architecture-decisions/)
- Agent memory: [Devin Knowledge Base](https://medium.com/@nitinmatani22/devins-knowledge-base-how-to-teach-an-ai-agent-your-codebase-conventions-6a30a89eb3a1) ·
  [Graphlit memory-framework survey](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks) ·
  [The Forgetting Problem (failure modes)](https://tianpan.co/blog/2026-04-12-the-forgetting-problem-when-agent-memory-becomes-a-liability) ·
  [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- Spec-driven dev: [Böckeler — SDD tools (Fowler)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) ·
  [github/spec-kit](https://github.com/github/spec-kit) ·
  [Adzic — Specification by Example, 10 yrs later](https://gojko.net/2020/03/17/sbe-10-years.html)

→ Back to [README](./README.md) · anatomy in [30](./30-zoom-2-anatomy.md)
