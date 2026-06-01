# Development Workflow

This repo is itself an AI-assisted-development project, so its *process* is unusually formalized. The rules in `.claude/rules/` are enforced and **override default agent behavior**. Read them before contributing.

## Test-first is a hard gate

From `tdd-guidelines.md` / `meta-rules.md` (and the global `~/.claude/CLAUDE.md`):

- **BDD = outer loop** (user-facing behavior, Given/When/Then scenarios) — the default framing for a feature.
- **TDD = inner loop** (internal logic/algorithms within a scenario step), red-green-refactor.
- **One at a time.** Write exactly ONE test/scenario, **run it to see it fail**, then write the minimum implementation, then run it green. Writing multiple tests at once, or implementation before a failing test run, is a rule violation. Only DB tables/migrations and empty skeleton classes (for imports) may exist before the test.

## The 4 Pillars of Testing

`.claude/rules/testing-pillars.md` defines Reliability / Validity / Sensitivity / Resilience and how they weight by test type (unit vs integration vs e2e). Consult it before writing tests — feature-development-guide explicitly requires locating this doc first.

Test layout in this repo: tests are **colocated** with source (`*.test.ts` / `*.test.tsx` next to the file). Vitest `include` covers `src/**` and `app/**`. Integration tests use the in-memory Mongo harness (`src/test/use-test-mongo.ts`); component tests opt into jsdom per-file.

## Incremental + progress tracking

`feature-development-guide.md`: plan high-level (steps + acceptance criteria + test *type* only), pause for explicit user approval ("implement it"), then implement one step at a time, fully, tracking status in `IMPLEMENTATION_PROGRESS.md` (status emojis, test lists). Files are kept **under 300 lines** for AI context management.

## Orchestrated feature dev + scratch files

The repo uses an `orchestrated-feature-dev` skill that produces many planning/research scratch `.md` files at the repo root. **These are gitignored** (`.gitignore`):

- `RESEARCH_OUTPUT*.md`, `RESEARCH_FOLLOWUP_*.md`, `PLAN_STEPS*.md`, `implementation-plan*.md`, `INVESTIGATION_STEP_*.md`, `VALIDATION_*.md`
- Exception: **`IMPLEMENTATION_PROGRESS.md` is tracked.**

So the many `INVESTIGATION_STEP_*`, `PLAN_STEPS_*`, `RESEARCH_*` files at the repo root are transient working state, not durable docs — the durable record is `docs/` + git history. The `.workflow-archive/` directory holds archived slice working state.

## Centrally-managed skills

`.ai-rules.json` declares the rule `categories` and `skills[]` this project subscribes to from a central **AI-rules-repo**; the user syncs them into `.claude/`. The AI-Kanban-specific `ai-kanban-work-card` skill (the multi-file `/work-card` dispatcher) is authored centrally but only AI-Kanban pulls it.

## Tooling gates

- **Biome** (`biome.json`) is the single lint+format tool (2-space indent, double quotes, organize-imports on, `noUnusedImports: error`; CSS files excluded; `src/components/ui/**` relaxes an a11y rule). Run `npm run lint` / `npm run format`.
- **CI** (`.github/workflows`, on push/PR to `main`): install → cache mongodb-memory-server binaries → **Lint (Biome)** → **Type-check (`tsc --noEmit`)** → **Test (`vitest run`)`. E2E is not in CI.

## Git conventions

- Default branch is `main`; branch before committing if on `main`.
- Commit messages are conventional (`feat(cards):`, `docs:`, `ci:`, `chore:` — visible in `git log`). Slices are recorded as `docs:` commits.

## Slicing model

Work proceeds in numbered **slices** (slice 1 = board, slice 3 = hygiene/parse-on-read/audit log, MCP dispatch slice). Each slice is scoped in a design doc, reuses prior slices unchanged + additively, and records progress in `IMPLEMENTATION_PROGRESS.md` and a `docs/design/*-progress.md` note.
