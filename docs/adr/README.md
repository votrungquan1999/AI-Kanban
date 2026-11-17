# Architecture Decision Records

Short, dated records of significant architecture decisions: the context, the decision, and its consequences. One file per decision, numbered. A decision is changed by adding a new ADR that supersedes the old one — existing ADRs are not rewritten.

| ADR | Title | Status |
| --- | ----- | ------ |
| [0001](./0001-execution-architecture-staged.md) | Execution architecture: reused-session dispatch now (2′), pty-per-card later (3) | Accepted (2026-05-31) |
| [0002](./0002-session-ownership-by-session-id.md) | Sessions own cards by `sessionId`; `dedupeKey` is for imported cards only | Accepted (2026-11-17) |
