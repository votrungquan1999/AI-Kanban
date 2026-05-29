---
description: 'Meta rules for Claude Code: rule application and code quality guidelines'
---

# Meta Rules

These rules MUST always be followed unless explicitly overridden.
For each task, Claude Code MUST double-check:

1. Which rules were applied.
2. Whether any relevant rules were missed.
3. If any rule conflicts exist, resolve them explicitly.

- ALWAYS check all applicable rules before making any changes.
- ALWAYS explain which rules were applied in the output.
- MUST keep files under **300 lines** for AI context management.
- NEVER require running/building the server to validate output.
- NEVER run `npm run build` or `npm run dev` after completing tasks, the user will handle this.
- ALWAYS use `npm install` to install packages. NEVER add packages directly to `package.json`.
- AI MAY replace entire components or structures if it improves clarity/compliance.
- For complex changes, AI MUST ask:
  - "Am I correct?"
  - "Which rules apply here?"
  - "Did I miss any relevant rules?"
- Apply the multi-shot method of prompt engineering: After editing around 5 files, should ask the user to review if the current direction is correct, then continue with the next 5 files. This iterative feedback approach helps ensure the AI stays aligned with user expectations and corrects course early if needed.

## Scope Management

- NEVER implement unused/future features not explicitly requested by the user.
- MUST ask 1-2 clarifying questions before implementing (or more if user explanation >100 characters).
- Focus on what exists in the system currently, not what could be extended unless explicitly requested by the user.
- When user provides long explanations (>100 characters), ask additional clarifying questions to verify scope and approach before proceeding.
- Only extract reusable components/functions when the same logic is repeated at least **3 times**. Two occurrences do not justify extraction — wait for the third to ensure a good abstraction emerges.

## Error Handling

- NEVER use try-catch blocks defensively around every operation.
- ONLY place try-catch blocks at intentional error boundaries where you want to catch all errors from lower-level code.

## Edit Verification and Retry Logic

- After EVERY file edit operation, MUST verify that the edit was successful.
- If an edit fails:
  1. Read the file again to understand the current state.
  2. Retry the edit with corrected parameters based on the actual file content.
  3. Repeat the verification process after each retry.
  4. **If the edit fails twice consecutively**, split it into multiple smaller, independent edits targeting smaller sections of the file. Large edits are prone to timeouts — smaller, focused edits are more reliable.
  5. Continue this cycle until the edit succeeds or determine that manual intervention is required.
- NEVER assume an edit succeeded without checking the tool's response.
- If multiple consecutive retries fail (> 3 attempts), explain the issue to the user and request guidance.

## Test-First Enforcement

- When doing test-first: NEVER write implementation code before running the test.
- ONE test at a time. Run it. See the result. Then decide whether to implement.
- The test run is a GATE — skipping it is a rule violation.

## Planning Mode

- When in planning mode and a `.md` file has already been generated, ALWAYS create a new file for any plan changes requested by the user.
- NEVER modify the existing `.md` file when the user requests changes to the plan.
