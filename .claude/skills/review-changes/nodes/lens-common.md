# Shared Lens Rules

Rules every review lens follows. Your specific focus is in the `node-lens-*.md` file(s) your prompt names — one if you carry a single lens, several if you are a grouped agent; this file is the common discipline either way.

## Scope

- Review **ONLY what this change is answerable for** — the code the diff introduced or changed, plus code outside it that the diff **newly reaches, feeds, exposes, or multiplies**. An unrelated pre-existing issue on untouched code is out of scope; a pre-existing flaw this change is the first to trigger is in scope, filed with the matching Origin below. (**Architecture is the exception** on *reading* — judging system fit requires reading the structure around the change; its node file defines how far that goes. The fault it reports must still belong to the diff.)
- **Read the diff from `./tmp/review-changes/DIFF.patch`** — holistic already captured it there — instead of re-running `git diff` yourself. Use `Read` with an offset to page through a large patch, or `grep` it for a path. Shell out to git only for something the patch genuinely cannot answer (full file context around a hunk, history of a line).
- Read `./tmp/review-changes/HOLISTIC.md` first for shared framing: the intended approach, constraints, and the root cause being solved. Judge the change against that intent.
- Assume intent is correct unless there is clear risk. Prefer concrete, actionable suggestions and explain the "why".
- Judging the diff sometimes depends on code **outside** it — a callee, a caller, a type, a config, a runtime assumption — that you haven't read. Don't guess and don't stay silent: mark the finding `Needs verification: yes` and name what to check (see [Flag findings that need a code-level check](#flag-findings-that-need-a-code-level-check) below).

## Origin — say where the problem came from

Every finding carries an **Origin** so the reviewer can tell whether this change caused the problem or inherited it. You **state** it; you do not judge on it. Origin never changes severity and is never a reason to soften or drop a finding — a pre-existing bug this change is the first to trigger harms production exactly as much as a new one.

- `introduced` — this change created the defect.
- `pre-existing — touched` — the defect predates the change; the diff only moved, reformatted, renamed, or edited around it. Say so plainly: the author did not write this bug.
- `pre-existing — newly reached` — the faulty code predates the change, but the change is what now calls it, feeds it new input, exposes it on a new surface, or multiplies its cost. **Name what the diff did to reach it** — that link is the whole justification for reporting it.

**Decide it from the patch, cheaply.** A `+` line carrying the defect is `introduced`; a context line or code outside the diff is pre-existing, and you then pick which of the two pre-existing forms applies. Do **not** run `git blame` per finding — the patch settles most cases for free.

**When the patch cannot settle it, do not guess.** Moved code, a rename, or a re-indent makes a relocated old line look introduced. Write your best guess, append `(unconfirmed)`, and mark `Needs verification: yes` naming the origin question — the verify phase resolves it against history.

## What NOT to flag (false positives)

- **Unrelated** pre-existing issues — problems on untouched code this change neither reaches nor worsens (a pre-existing flaw the change *does* newly reach belongs in the review, with that Origin)
- Anything a linter / typechecker / compiler would catch (missing imports, type errors, formatting) — assume CI runs these
- Pedantic nitpicks a senior engineer wouldn't raise
- Changes that are clearly intentional and part of the broader change
- Polish on a screen built only so the owner can verify a feature by hand (loading flashes, rare edge states, nearly unreachable errors, cosmetic races); flag only what would stop that check or show wrong data

Do NOT run the build or typecheck — that is CI's job.

## Severity

- **MUST FIX** — could cause bugs, security vulnerabilities, or data loss
- **SHOULD FIX** — important for maintainability, performance, or best practices
- **NIT** — minor style/consistency

## Failure mode (must be meaningful)

For each finding, give the **failure mode**: the concrete sequence that turns the issue into a real bad outcome — **trigger → what the code does → the harm**. It must describe something that actually happens at runtime, not a restated worry.

- Be **concrete and specific to THIS code**: name the trigger (a user action, an input value, a timing/concurrency window, a second tab or request), trace what the code actually does step by step, and end at the observable harm (wrong data, a race, a crash, a leak, a user locked out). Reference bar for the level of detail: *"user updates a field → mutation returns task IDs → FE polls → user refreshes → FE returns empty pending IDs while the BE task is still IN_PROGRESS → user edits assignees and races the worker."*
- A vague restatement — "this could cause bugs", "may break", "is risky" — is **NOT** a failure mode; it just repeats the description. **Never write a hollow one to fill the field.**
- If you cannot construct a concrete runtime failure (the finding is a pure maintainability / readability / style concern), **omit it and say so**: `No distinct failure mode — <maintainability/readability> concern`.
- Two lenses have an additional accepted form, each defined in its own node file and held to the same specificity bar. **No other lens may use either.**
  - **architecture** — the *design consequence*: what the change forces later, when nothing fails at runtime.
  - **tests** — the *missed defect*: the concrete bug that ships green because the test cannot fail. A test that guarantees nothing has no runtime failure of its own, so name the defect it was believed to be covering and trace that to the harm. Do **not** downgrade such a finding to a maintainability concern — the harm is a real bug reaching production behind a passing suite.

## Flag findings that need a code-level check

Most findings you can confirm from what you've read — report those as settled facts. But when a finding **rests on something you could not confirm from the code you saw** — the behavior of a function outside the diff, what a caller actually passes, a runtime/ordering assumption, whether a guard exists elsewhere, or **whether the defect predates the diff** — mark it `Needs verification: yes` and say exactly what to check. If you fully confirmed the finding yourself, mark `Needs verification: no`. Only the `yes` findings get a verification pass; everything else is trusted as-is, so do not flag a finding you are already sure of.

## Output

Write findings to the `./tmp/review-changes/LENS_<name>.md` path named in your prompt. **Grouped agents:** `node-lens-grouped.md` extends this format with a per-finding `Lens` field and a per-lens Coverage block — follow it instead, since one file then carries several lenses.

```markdown
# Lens: <name>

## Findings

### [Issue Title]
- **Severity**: MUST FIX / SHOULD FIX / NIT
- **File**: [path:line]
- **Origin**: introduced / pre-existing — touched / pre-existing — newly reached [+ what the diff did to reach it; append "(unconfirmed)" if the patch couldn't settle it]
- **Description**: [What's wrong]
- **Failure mode**: [Concrete trigger → behavior → harm, OR "No distinct failure mode — <maintainability/readability> concern". Never a vague restatement — see the rules above.]
- **Why it matters**: [Impact/risk — the magnitude, given the failure mode above]
- **Needs verification**: yes — [what to check, and where] / no
- **Suggested fix**: [Concrete suggestion; code snippet only if helpful. **Deleting code that earns nothing — a test that cannot fail, a branch nothing reaches — is a valid fix, not a cop-out.** Say "delete it" when that is the answer, instead of proposing a way to improve it.]

## Notes
[Anything good worth calling out, or "no issues found in this lens"]
```

If you find no issues, write the file with an empty Findings section and say so explicitly. Then report back to the orchestrator: number of findings, the highest severity, and — for every finding you marked `Needs verification: yes` — a one-line entry (lens, `file:line`, severity, and what to check) so the orchestrator can route it to a verifier without re-reading this file.
