# Node: Quality Lens

Review code quality and standards compliance in the diff. Read `lens-common.md` for shared rules and `HOLISTIC.md` for framing.

## Focus

1. **Code quality**
   - **Naming** — clear, descriptive variable/function names
   - **Structure** — logical organization and flow
   - **Duplication** — repeated logic that should be extracted (only flag at 3+ repetitions)
   - **Comments** — present for genuinely complex logic, accurate (no comment rot), not noise
   - **Typing** — proper types, no unjustified `any`

2. **Standards compliance**
   - Follows project conventions (check the root `CLAUDE.md` and any `CLAUDE.md` in the directories the diff touches — cite the specific rule when flagging)
   - Uses established patterns rather than reinventing
   - New dependencies are justified
   - Breaking changes are documented

## Boundary with the architecture lens

You own **micro-architecture** — hygiene inside the module: naming, structure, duplication, typing, comments, convention compliance. Feature-level design belongs to the **architecture** lens: layer/responsibility placement, data model, contract and route shape, coupling and external dependencies, alternative designs. If a concern is really "this decision is expensive to reverse once merged," leave it to architecture rather than filing it as a convention nit — that framing is what buries it.

For substantial refactoring, recommend the `@code-refactoring` skill rather than prescribing a large rewrite inline. Keep nits proportionate — don't bury real issues under style.

## Output

Write `./tmp/review-changes/LENS_quality.md` using the format in `lens-common.md`.
