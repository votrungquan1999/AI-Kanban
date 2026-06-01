# Local Development

## Prerequisites

- **Node** pinned by `.nvmrc` to **26** (CI uses `node-version-file: .nvmrc`). `nvm use` to match.
- **MongoDB** running locally (or Atlas). The dev app needs a real instance; tests use an in-memory mongod (downloaded on first run).
- npm (use `npm install` / `npm ci` — the repo rule forbids editing `package.json` directly to add packages).

## Environment

Copy `.env.example` → `.env.local` (Next.js auto-loads it for `next dev`/`next build`). Variables (read by `src/db/mongo.ts`):

- `MONGODB_URI` — connection string (default `mongodb://127.0.0.1:27017`).
- `MONGODB_DB` — optional database name (defaults to `ai_kanban`); if omitted the driver uses the URI's db.
- `MCP_BASIC_USER` / `MCP_BASIC_PASS` — HTTP Basic credentials gating the remote MCP route at `POST /api/mcp` (read by `app/api/mcp/route.ts`). A single shared credential for the whole session pool; set real values in Vercel / `.env.local`, never commit. See [api-mcp.md](./api-mcp.md) for the route.

`getDb()` caches a single connection module-wide (survives Next dev hot-reload); concurrent first calls share one in-flight connect promise.

## npm scripts (`package.json`)

| Script | Command | Use |
| --- | --- | --- |
| `dev` | `next dev` | run the board app |
| `build` / `start` | `next build` / `next start` | production build/serve |
| `test` | `vitest` | watch-mode unit/integration |
| `test:run` | `vitest run` | one-shot (used in CI) |
| `lint` | `biome check .` | lint (CI gate) |
| `format` | `biome format --write .` | format |
| `dev:e2e` | `MONGODB_DB=ai_kanban_e2e next dev -p 3001` | dev server for e2e (separate db, port 3001) |
| `test:e2e` | `playwright test` | run Playwright specs |

> Repo rule (`meta-rules.md`): **do not run `npm run build`/`npm run dev` to validate** completed work — the user handles that. Validate via tests + type-check + lint instead.

## Running the board

1. Start MongoDB.
2. `npm install`
3. `npm run dev` → board at the default Next dev port.

## Running tests

- **Unit/integration (Vitest):** `npm run test:run`. Default environment is `node` (for the service/data layer); component tests (`*.test.tsx`) opt into jsdom with a top-of-file `// @vitest-environment jsdom` pragma. Integration tests boot an **in-memory mongod** per test file via `useTestMongo()` from `src/test/use-test-mongo.ts` (sets `MONGODB_URI`, tears down + clears the connection cache after). Setup file: `vitest.setup.ts` (jest-dom matchers). Globals are enabled.
- **E2E (Playwright):** the Next dev server is started **manually** (Playwright does not manage it). In one terminal: `npm run dev:e2e` (port 3001, `ai_kanban_e2e` db). In another: `npm run test:e2e`. The spec (`e2e/board.spec.ts`) clears the e2e collections before each test and drives the real Mongo. Override the target with `E2E_BASE_URL`. Single project: Desktop Chrome, not parallel.

## Type-checking

`npx tsc --noEmit` (a CI gate). `tsconfig.json`: strict, `noEmit`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `@/* → ./src/*`.

## Per-card workspaces (runtime, gitignored)

The loop creates per-card git worktrees under `/workspaces/card-N/` — these are **gitignored** (they contain nested working trees). The agent creates them itself with `git worktree add`; no app code wraps git. Branch convention: `aikanban/card-N`.

## See also
- [development-workflow.md](./development-workflow.md) for the TDD/BDD process, Biome, CI, and the orchestrated-feature-dev scratch files.
