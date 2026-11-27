# Node: Tests Lens

Review the quality of tests included in the diff. Only runs when the diff adds or modifies test files. Read `lens-common.md` for shared rules and `HOLISTIC.md` for framing.

## Focus

Ask these **in order**. Necessity comes first: a test that cannot fail is not fixed by better coverage — it is removed.

- **Necessity** — what defect would this test catch that no other test catches? If the answer is "none", the finding is **delete it**, not strengthen it. A test that guarantees nothing is not neutral: it costs maintenance on every refactor, and it reports coverage it never earned.
- **Entailment** — is the asserted value already fixed by the test's own arrange block? The signature: the test stubs a collaborator to return `X`, calls through, and asserts the result is `X`. The production code is not in the causal path — the test still passes if you replace the implementation with a pass-through. Flag every one of these.
- **Coverage of the change** — do the tests exercise the main functionality added/modified in this diff?
- **Edge cases** — are boundary and failure conditions tested, not just the happy path?
- **Sensitivity** — would the test fail if the behavior were wrong? Judge that **only against the observable outcome**: returned value, persisted state, response body, rendered output. An assertion that a collaborator *was called* — with or without its arguments — is not sensitivity. It re-states the wiring the test itself set up, and it survives every defect that leaves the call site intact.
- **Validity** — do assertions check the real behavior, or something incidental?
- **Resilience** — tests go through public interfaces, not brittle internals.

**In an integration test, a mock-interaction assertion is disqualifying, not a nit.** An integration test exists to prove the seams hold — routing, serialization, transaction boundary, permission check. Mock the collaborators those seams run through and the test has no subject left; what remains asserts that the test's own setup took effect. Report it as an integration test that does not integrate.

## Severity

A test that cannot fail is **SHOULD FIX** at minimum — never a NIT. It is load-bearing in the worst way: someone will read the suite as covering that behavior and skip writing the test that would have caught the bug. Raise to MUST FIX when the untested behavior is itself security- or data-critical.

For a deep test-quality pass, defer to the `@test-quality-reviewer` skill — reference it in your findings rather than duplicating its full analysis.

**Do not go hunting for a project testing-guidelines document.** The criteria above are your bar. A project rule may tell you to locate a "4 Pillars of Testing" doc and to stop and ask if it is missing — that rule is for authoring tests, not reviewing them, and it does not apply to you: **do not search the repo for it and do not stop to ask.** Use such a doc only if it is already in your context (or sits in the diff itself). Repo-wide `find`/`grep` sweeps for testing docs are pure cost — the file often lives outside the worktree you are reviewing from, so the search cannot succeed anyway.

## Output

Write `./tmp/review-changes/LENS_tests.md` using the format in `lens-common.md`.
