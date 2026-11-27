---
name: validate-pr-comments
description: Fetches every unresolved comment on a GitHub PR or GitLab MR, checks out the branch in a git worktree, and classifies each as VALID, INVALID, OUTDATED, or PARTIAL against the current code — with the precise fail condition for each VALID bug claim — then replies (and resolves only on request) after the user gives verdicts. Use when the user says "validate PR comments", "check PR feedback", "are these review comments still valid", "are these review comments real issues", "review the comments on PR #N", "review feedback on this PR", "pull the comments and tell me which are valid", "help me triage PR comments", asks to triage reviewer feedback against actual code, or asks for a verdict on a bot review.
allowed-tools: Agent, Read, Grep, Glob, Bash, Write
---

# Validate PR Comments

You are a reviewer-of-reviewers. For a given PR/MR, fetch every unresolved comment, inspect the actual code on the branch, and decide whether each comment is technically correct, already addressed, or off-base. Reviewers (AI bots especially) inflate hypothetical risks; the fail-condition framing makes both you and the user judge severity from facts.

The skill has two phases: **triage** (read-only, delegated) and **reply** (main session, only after the user's verdict message).

## Execution — delegate triage to a Sonnet 5 sub-agent

You run in the **main session** as a thin coordinator — do **not** perform the triage steps yourself:

1. Resolve **the PR/MR identifier** (URL, or number + repo) from the conversation.
2. Spawn **one** sub-agent — `Agent` tool, `subagent_type: general-purpose`, `model: "sonnet"` (Sonnet 5). Pass it the resolved identifier, the workspace `<identifier>`, and the triage steps below as its instructions. It fetches everything fresh via `gh`/`glab` and checks out its own worktree.
3. It returns the counts line, the per-comment blocks, and the report and worktree paths. Relay the blocks and the suggested-action line to the user; keep the raw comment JSON and code reads out of the main context.

For a single named comment, or "should I fix this?" without a URL, skip the sub-agent and answer directly with the same verdict shape.

## Inputs

- PR/MR identifier — URL, or `<number>` plus repo if not running inside the target repo (ask if missing)
- Platform — detect from the URL or `git remote get-url origin` (`github.com` → `gh`, `gitlab` → `glab`); confirm if ambiguous

## Triage steps (the sub-agent's instructions)

### 1. Verify the CLI

```bash
gh --version  || echo "gh missing"
glab --version || echo "glab missing"
```

If the required CLI is missing, stop and tell the user to install and authenticate it (`gh auth status` / `glab auth status`).

### 2. Fetch every comment, keep the unresolved ones

**GitHub (`gh`):**

```bash
gh api "repos/{owner}/{repo}/pulls/{num}/comments" --paginate   # inline review comments
gh api "repos/{owner}/{repo}/pulls/{num}/reviews" --paginate    # review summaries
gh api "repos/{owner}/{repo}/issues/{num}/comments" --paginate  # general PR comments
gh pr view {num} --json headRefName,headRefOid,baseRefName,title,url
# thread resolved state comes from GraphQL: pullRequest.reviewThreads { isResolved, comments { ... } }
```

**GitLab (`glab`):**

```bash
glab api "projects/:id/merge_requests/{iid}/discussions" --paginate  # threads with notes and resolved flags
glab mr view {iid} --output json
```

- **Skip** system events (push notices, branch updates, auto "approved" messages) and pure LGTM/approval comments; count them.
- **Unresolved = the last note's resolved flag is `false` or `null`.** A reply on a resolved thread re-opens it, so the first note's flag is stale.
- For each kept thread capture: thread/discussion id (needed for replies), author, body, file path + line (if inline), original commit SHA (if available).

### 3. Create the worktree

```bash
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="../${REPO_NAME}-pr-{num}"
git fetch origin {head_branch}
git worktree add "$WORKTREE_PATH" "origin/{head_branch}"
```

Read and grep only inside `$WORKTREE_PATH`. Leave the worktree in place and name its path in the report.

### 4. Classify each comment

First, **does the comment describe code actually present now?** For inline comments, check the file and line still exist and compare the original SHA with HEAD (`git diff <original_sha>..HEAD -- <file>`); read at least 10 lines of context. For summaries and general comments, extract the concrete claim and locate the code it is about.

Then assign one verdict:

- **VALID** — the claim is correct and the issue is still in the code.
- **OUTDATED** — the code it describes was since fixed, refactored or removed.
- **INVALID** — technically wrong, a misreading, or the suggested change would regress behavior.
- **PARTIAL** — one sub-point holds and the main critique does not, or vice versa.

**A bug claim is VALID only if you can write its fail condition:** the exact runtime preconditions joined by AND, ending in `→ <observed failure>`, using real variable names from the code. Not "could break", not "fragile". If a precondition needs a producer that doesn't exist, a config that isn't set, or a hypothetical future scheme, the claim is INVALID (defensive future-proofing): say which precondition can't currently be met.

**Non-bug comments** (test gaps, nits, style) are VALID only for a real coverage hole or maintainability issue that the project's rules support acting on; cite the rule.

Calibration for common bot findings:

- **Usually INVALID:** extract a literal used only 1–2 times (under a rule-of-3 convention); an `as X` cast matching patterns already in the codebase; tests for a conditional with no behavior change; "could break if a future producer…" with no current producer; a hardcoded count in a test when the count is the assertion's point; a missing component test when an integration test already covers the path.
- **Usually INVALID:** a requested test that only checks two internal code paths agree, or covers a case the PR did not introduce (reply 'it was there before this PR', not 'the client never sends it'). Prefer extending an existing test over a new one.
- **Usually VALID:** a condition change that silently drops behavior for some inputs; a new code path no test covers; a real mismatch between producer and consumer (e.g. a registry key).

For every finding record an **Evidence** label from the meta-rules: `checked` (read in the worktree; cite `file:line`), `checked twice` (two independent sources, e.g. code and a test run), `reported` (taken from the comment or platform flag without re-checking), `inferred` (reasoned from the code, not observed; say from what), or `guess` (vague comment, code not located).

### 5. Write the report

Write it to `./tmp/<identifier>/validate-pr-comments.md` in the **original repo** (not the worktree), `<identifier>` being the PR/MR number or a short slug. Create the folder if missing; **if it already holds artifacts from unrelated work, STOP and ask the user rather than overwriting.** No wide tables: blocks and tight bullets only.

```markdown
## PR/MR
[Title] — [URL]
Branch: `<head>` → `<base>` @ `<head_sha_short>`
Worktree: `<absolute path>` (remove with `git worktree remove <path>` when done)

## Summary
- Unresolved comments: N (inline: X, review summaries: Y, general: Z) · skipped (system/LGTM): E
- VALID: A · OUTDATED: B · INVALID: C · PARTIAL: D

## Findings

### 1. [VALID] <one-line summary>
- **Comment**: <author> on `path/to/file.ts:42` — "<quoted fragment>"
- **Fail condition**: <precondition A> AND <precondition B> → <observed failure>
- **Reason**: one or two sentences, drawn from the code, not from the comment's framing.
- **Recommendation**: <concrete fix>
- **Evidence**: checked — `path/to/file.ts:42`

### 2. [INVALID] <summary>
- **Comment**: ...
- **Reason**: ...
- **Draft for you to edit** (not posted unless you say "post"): "<short, respectful counter-argument grounded in the code>"
- **Evidence**: ...

### 3. [OUTDATED] / [PARTIAL] <summary>
- **Comment**: ...
- **Reason**: e.g. line X was rewritten in `<sha>`; or which part holds and which does not.
- **Evidence**: ...

**Suggested action:** 1 fix · 2 invalid · 3 fixed · …
```

End the chat reply with the worktree path and the counts line.

## Explain on request

The per-verdict reason stays one or two sentences. When the user says "explain" (for one comment or all), give the full zero-context explanation: name each moving piece, the rule that makes them collide, a timeline of how the failure happens, then the blast radius and whether the fix is a judgment call.

## Reply phase (main session, after the user's verdict message)

Do nothing on the PR until the user answers the triage. They typically reply in one line, e.g. "fix 1 and 3, reply won't fix to the rest" or "fix 1, reply fixed, then resolve".

- **Fix** the items they accept before replying "fixed" on them.
- **Reply with the user's exact phrase** when they give one (`fixed`, `won't fix`, `invalid`, …): verbatim, no lead-in, no rationale, no thanks.
- **Post a drafted counter-argument only when the user says "post"**, and post the text as they left it after editing.
- **Resolve a thread only when the user's message says "resolve".** Otherwise reply and leave the thread for the reviewer to close.
- Use the same CLI you fetched with: GitHub replies via the review-comment reply endpoint (resolve via the `resolveReviewThread` GraphQL mutation); GitLab replies via `discussions/{id}/notes` (resolve via `PUT discussions/{id}?resolved=true`).
- Finish with a tally, e.g. "3 replied 'fixed', 2 replied 'won't fix'; resolved: none".

## Critical rules

**DO:**
- Read code from the worktree, not the current branch.
- Quote only the relevant fragment of long comments.
- Cite `file:line` for every VALID and PARTIAL finding.
- Treat the platform's resolved/outdated flags as a hint, then verify against the code.

**DO NOT:**
- Reply, resolve, push, or fix anything during triage.
- Call a bug VALID without writing its fail condition.
- Add text beyond the user's exact phrase when replying.
- Remove the worktree at the end.
- Re-review the whole PR; only judge the comments. For a broad review use `@review-changes`.
- Output raw API JSON to the user.

## Related skills

- `@review-changes` — full review of the diff (use when there are no comments yet)
- `@create-pr` — generate PR title/description before requesting review
