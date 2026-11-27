# AI-Kanban

## Before pushing

- Run the three gates CI runs (`.github/workflows/ci.yml`), in order, and push only when all pass: `npm run lint`, `npx tsc --noEmit`, `npm run test:run`. Vitest transpiles without type-checking, so green tests do not mean the code type-checks; `tsc --noEmit` is the only type gate.
