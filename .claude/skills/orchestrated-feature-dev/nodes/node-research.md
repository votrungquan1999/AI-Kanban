# Node: Research

Focused context-gathering phase. Read the codebase to understand patterns, architecture, and affected areas.

> **Task workspace:** All state files live in the task working directory `<ws>` (`./tmp/<identifier>/`) given in your prompt. Every state-file path below is relative to `<ws>`.

## Input

Read the user's feature request from the conversation context.

## Execution

1. **Identify the feature area** — what part of the codebase is affected?

2. **Read broadly first:**
   - Entry points and main files for the affected area
   - Related tests to understand existing behavior
   - Types, interfaces, and data models
   - Configuration files if relevant

3. **Read deeply second:**
   - Implementation details in the core affected files
   - Patterns used in similar features (if any exist)
   - Utility functions and shared helpers that might be reused

4. **Survey the project's test patterns — required, and deeper than a glance at the config.** The BDD loop defaults to the integration level (drive the real flow through the client-facing entry point with real collaborators), so it needs to know what this project already gives it. Find:
   - The **test command** — `package.json` scripts (or `Makefile`, `pyproject.toml`, `justfile`); note whether integration/e2e has a script of its own
   - **Test locations and naming** — `tests/`, `__tests__/`, `*.test.ts` vs `*.integration.test.ts` vs `tests/e2e/`
   - **Harness and setup files** — `vitest.config`, `jest.setup`, `conftest.py`, `playwright.config`, testcontainers, `supertest`, `msw`, an in-memory or throwaway test DB
   - **Fixtures, factories, and seeds** — how a test gets a user, a record, an authenticated client; how state is reset between tests
   - **One real example** — read an existing integration/e2e test end to end. Name it: it is the file the BDD sub-agents will mirror, and it carries conventions no config file states.

   Then commit to a verdict in the output: the harness that exists, the exact command that runs it, and the example file to mirror — or `none found`. `none found` is a real answer and must be reported plainly; the orchestrator turns it into a question for the user at the Phase 1 gate. Do NOT propose a harness to build, and do not treat a pile of mock-heavy unit tests as an integration harness.

5. **Research the standard approach:**
   - Use `@web-search` to find the standard/best/recommended way to implement this type of feature
   - Look for established patterns, common pitfalls, and industry best practices
   - Compare what you find externally with the patterns already in the codebase

6. When researching external libraries or APIs, use `@context7` for documentation queries and `@web-search` for broader research.

7. **Count what you read** — track the number of files examined.

8. **Resolve code-answerable questions yourself — do not defer them.**
   If something can be answered by reading the code (how a function behaves, where a type is defined, whether a pattern already exists, how an existing flow works), keep reading until you have the answer. Do NOT write "this needs further investigation" or "the code should be checked to understand X" for anything you could resolve by reading more files.

   A thread belongs in **Follow-up Investigations Needed** ONLY when it is code-answerable but you genuinely could not finish chasing it in this pass — e.g. the scope is too large for one agent, it branches into a separate subsystem, or you discovered it late. Each such item must be a concrete, self-contained investigation target the next agent can pick up cold (a specific question + where to look), NOT a vague "look into this more."

   A thread belongs in **Open Questions for the User** ONLY when it is a product/requirement decision the code cannot answer (desired behavior, scope boundary, business rule).

## Output

Write findings to `<ws>/RESEARCH_OUTPUT.md`.

If you were spawned as a **targeted follow-up agent** (you were given a specific investigation item), instead write to the `<ws>/RESEARCH_FOLLOWUP_[id].md` file named in your prompt, using the same section structure below. Resolve your assigned item fully; if it uncovers further code-answerable threads, list them under "Follow-up Investigations Needed" so the orchestrator can spawn another round.

Then fold a condensed version of your findings into the matching section of `<ws>/RESEARCH_OUTPUT.md`, linking `RESEARCH_FOLLOWUP_[id].md`. Append with Edit under your own subsection `### Follow-up: [id]` beneath that section and never rewrite the file — parallel follow-up agents would clobber each other. Also append ` — resolved, see RESEARCH_FOLLOWUP_[id].md` to your item's line under `## Follow-up Investigations Needed`, so the planner does not read it as still open.

```markdown
# Research Output

## Files Read: [count]

## Feature Area
[Brief description of what area of the codebase is affected]

## Key Patterns Found
- [Pattern 1]: [Where it's used and how]
- [Pattern 2]: [Where it's used and how]

## Existing Related Code
- [File/function]: [What it does and how it relates]

## Affected Areas
- [Area 1]: [How it's affected]
- [Area 2]: [How it's affected]

## Testing Patterns
- **Integration harness:** [name + what it covers] | none found
- **Command to run it:** [the project's own script, e.g. `npm run test:integration`]
- **Example to mirror:** [path to one existing integration/e2e test]
- **Fixtures / factories / state reset:** [how a test gets its preconditions and cleans up]
- [How tests are organized in this part of the codebase]
- [Other testing utilities available]

## Follow-up Investigations Needed
<!-- Code-answerable threads you could not finish this pass. The orchestrator will spawn a targeted sub-agent per item. Leave empty if research is complete. -->
- [Concrete question]: [Exact files/dirs/symbols the next agent should start from]

## Open Questions for the User
<!-- Product/requirement decisions only — NOT things the code can answer. -->
- [Decision the user must make]
```

**CRITICAL — pausing depends on who you are:**
- If you are a **targeted follow-up agent**, do NOT pause for the user. Write your findings file, fold it into `RESEARCH_OUTPUT.md` as above, and return a brief summary to the orchestrator: the items you resolved and any new follow-up items, or "no new items" explicitly when there are none (empty must be distinguishable from lost).
- If you are the **initial research agent**, write the output. The orchestrator decides whether to spawn follow-up agents or pause for the user — see the skill's Phase 1. Do not invent a user pause yourself; report back to the orchestrator with whether "Follow-up Investigations Needed" is empty.
