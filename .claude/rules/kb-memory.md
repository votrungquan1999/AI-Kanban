<!-- DO NOT EDIT — managed by ai-rules sync. Overwritten on next sync. -->
# Knowledge Base Memories

## No Co-Authored-By trailers in commits

Never add `Co-Authored-By: Claude ...` trailers to commit messages. The user explicitly rejected this.

## Verify the current git branch before planning

Always run `git branch --show-current` at the start of a task — the conversation-start gitStatus may be stale if the user switched branches.

## Skip running tests during code review

During code review (e.g. /review-changes), do NOT run the test suite — assume tests pass. Focus on diff reading for correctness, design, ticket fit.

## Prefer structured lists over wide markdown tables

Don't render comparisons as wide multi-column tables — they wrap and misalign in terminal/IDE. Use bullet lists instead.

## Drafting a PR/MR is not permission to create one

Never run `glab/gh ... create` unless the user explicitly says to create the MR/PR. Drafting a title+description (e.g. /create-pr) is output-only — stop there.

## Ask the user to run tests after 2 opaque attempts

After 2 attempts where test output is opaque (hung, truncated, no real error), stop guessing — ask the user to run the command and paste output.

## Delegate to a subagent after 2 failed test-setup attempts

After 2 failed test-setup attempts on the same blocker (locator/flow), stop guessing — spawn a subagent to investigate (dump DOM, map path), then apply once.

## Uncommitted changes onto latest master = new branch + stash-pop

Uncommitted changes onto latest master: `git stash` → `checkout -b <new> origin/master` → `stash pop`. Don't rebase. Never `-X ours/theirs` — corrupts files.

## Link files at their actual worktree path, not the main checkout

When linking files on a worktree/feature branch, prefix with the worktree dir (e.g. `repo-TICKET-123/`), not the main checkout dir. Otherwise the IDE link is dead.

## Check package.json (or equivalent) for the project's test command

Always check `package.json` scripts (or equivalent) for the project's test command. Don't run raw `jest`/`vitest`/`pytest` — the npm script wraps env loading and exit flags.

## Concise comments, no ticket IDs

Code/test comments must be skimmable (typically one line, WHY-focused). Never include ticket IDs in source comments — they belong in commit messages / MRs, not the code.

## 2+ defensible behaviors → stop and ask the user

When a code path has 2+ defensible behaviors (lossy vs preserve, gate vs skip, fail-closed vs fail-open), stop and ask the user — overrides 'don't stop for review'.

## "could/can you" = a request → act. "could/can we" = a question → answer and recommend, do not act yet.

"could/can you" = a request → act. "could/can we" = a question → answer and recommend, do not act yet.

## On substantive multi-step work, run ai-kanban-track-session: open an in_progress card (tags=.ai-rules.json scope, +sessionId), append progress, set need_review when done. Skip trivial tasks.

On substantive multi-step work, run ai-kanban-track-session: open an in_progress card (tags=.ai-rules.json scope, +sessionId), append progress, set need_review when done. Skip trivial tasks.

## User says 'won't fix' / 'fixed' / 'invalid' (or similar short phrase) → post that exact phrase verbatim as the comment body. No lead-in, no rationale. Explain only if asked.

User says 'won't fix' / 'fixed' / 'invalid' (or similar short phrase) → post that exact phrase verbatim as the comment body. No lead-in, no rationale. Explain only if asked.
