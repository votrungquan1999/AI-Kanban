---
name: setup-private-skills
description: Configure private skills so the AI Rules CLI pulls them alongside public skills, publish a local skill privately under one or more scopes (or globally with no scope, visible to every workspace), and capture the current conversation as a new reusable skill. Use when wiring AI_RULES_SECRET + scope, sharing team/client skills, diagnosing missing private skills, or when the user says "set up private skills", "upload a private skill", "record this as a skill", or "capture this conversation as a skill".
allowed-tools: Read, Bash, Edit, Write
---

# Set Up Private Skills

Configure a project so the AI Rules CLI (`@quanvo99/ai-rules`) fetches **private** skills together with the public ones — publish a local skill privately (global by default, or scoped to one or more projects), or capture the current conversation as a brand-new skill and publish it.

## When to Use

- A project should receive skills that aren't public (team- or client-specific).
- The user wants to share a local skill privately rather than to the public catalog.
- The user wants to **capture the current conversation** (a procedure you just worked out) as a new reusable skill and publish it privately.
- Private skills "aren't showing up" after a pull and you need to diagnose the secret/scope wiring.

## How It Works (the contract)

Two pieces of state govern private skills:

- `AI_RULES_SECRET` — a shared secret in the environment. The CLI sends it as the `x-ai-rules-secret` header. **Required** for any private skill.
- `scope` — a tag (or tags) in `.ai-rules.json`. The CLI sends them as the `x-ai-rules-scope` header. **Optional**: it narrows to scope-specific skills; omitting it still delivers global ones.

The server merges any private skill whose scopes **intersect** the request scopes, **plus any global skill** (one uploaded with no scope — global skills are visible to every workspace), marking them `visibility: "private"`; public skills come back regardless. On **any** auth failure the server silently degrades to the public-only payload — there is no error and no "exists" leak. So:

- Secret set, no scope → public skills + **global** private skills (those uploaded without a scope).
- Scope set, no secret → public skills only (scope alone unlocks nothing).
- Both set and matching → public + global + scoped private skills.

The practical consequence: **if private skills don't appear, it fails silently** — re-check the secret value and the scope rather than looking for an error message.

## Prerequisites

1. A CLI with the `skill` command group (`skill upload`/`list`/`update`/`delete`) — the old top-level `upload` command is gone, replaced by `skill upload`. Check with `npx @quanvo99/ai-rules@latest --version`. If a project already pulled this skill before the rename, re-run `pull`/`sync` there to refresh its local copy with these instructions.
2. The `AI_RULES_SECRET` value, obtained from whoever owns the deployment's secret store. **Never commit it.**
3. (Optional) A scope tag, only if you want to limit a skill to specific projects (e.g. `personal`, `work`, `client-x`). Omit it for global skills.

## Steps

### 1. Identify the agent

Read `.ai-rules.json` at the project root and note the `agent` field. Private skills are supported for `claude-code`, `cursor`, and `antigravity`. If there is no `.ai-rules.json`, run `npx @quanvo99/ai-rules@latest init` first and pick the agent.

### 2. Make the secret available to the CLI

The CLI reads `process.env.AI_RULES_SECRET`. Export it in the shell — ideally from a shell profile so every session has it — or add it to a git-ignored `.env` the CLI process can see:

```bash
export AI_RULES_SECRET='<value-from-secret-store>'
```

Never print the value into committed files or logs.

### 3. (Optional) Set a scope in `.ai-rules.json`

Skip this step to work with **global** skills only. To narrow a project to scope-specific skills, add a `scope` field — an **array** of tags — at the top level:

```json
{
  "agent": "claude-code",
  "scope": ["personal"],
  "skills": []
}
```

A project can carry several scopes (e.g. `["personal", "ai-kanban"]`) and receives any private skill whose scopes intersect, **plus any global skill**. A legacy single string is still accepted and coerced to a one-element array. Scope is **optional**: with a valid secret but no `scope`, you still receive **global** private skills (those uploaded without a scope) — just none of the scope-specific ones.

### 4. (Optional) Publish a skill privately

When the user wants to share a skill privately — either an existing local skill or one captured from the current conversation.

**4a. Author the skill (when capturing from a conversation).** Skip if the skill directory already exists.

- Distill the reusable *method* from the conversation — generalize away the one-off specifics of this instance.
- Write `<skills-dir>/<skill-name>/SKILL.md` for the configured agent (`.claude/skills`, `.cursor/skills`, or `.agents/skills`). `<skill-name>` is short kebab-case. Frontmatter needs `name` and a one-line `description` that states what it does AND when to use it (the trigger phrases). Keep the body skimmable; add supporting files in the directory if the procedure needs references.
- 🛑 **Stop and show the user the SKILL.md (and the exact upload command below) and wait for explicit approval before uploading.**

**4b. Upload (`skill upload`).** The directory must contain a `SKILL.md`; every other file in it becomes a supporting file and is published with the skill.

**What gets published.** Everything in the folder except:

- **Built-in junk** — `.DS_Store`, `Thumbs.db`, `node_modules/`, `__pycache__/`, `.git/`, `*.pyc`. Always excluded; no configuration needed.
- **Anything matching an optional `skill.ignore`** at the skill root — gitignore syntax, one pattern per line. Applied after the built-in rules, so a `!keep.pyc` line can re-include a default-dropped file.

`skill.ignore` is itself published, so an installed copy filters the same way when someone edits and re-uploads from it. To keep one local, list `skill.ignore` inside itself.

Keep the `+x` bit on a script (`scripts/*.sh`) and it survives the round trip — the file installs executable.

```bash
npx @quanvo99/ai-rules@latest skill upload ./path/to/skill-dir \
  --agent claude-code \
  --scope personal          # comma-separated; a skill can carry multiple scopes
```

```bash
# Or, to publish globally (visible to every workspace):
npx @quanvo99/ai-rules@latest skill upload ./path/to/skill-dir \
  --agent claude-code \
  --global
```

`--scope` or `--global` is required: pass `--scope personal,work` to tag the skill to specific workspaces, or pass `--global` to make it a **global skill** (empty scope — visible to every workspace). Omitting both flags is now an error. The skill name is the directory's basename. Re-uploading the same `{agent, name}` upserts (replaces) it.

**4c. List, update, or delete a private skill.**

```bash
# Find the id you need below (prints id / name / agent / scopes for every private skill)
npx @quanvo99/ai-rules@latest skill list

# Patch one or more fields — send only what you're changing; omitted fields stay intact
npx @quanvo99/ai-rules@latest skill update <id> --description "new description"
npx @quanvo99/ai-rules@latest skill update <id> --content-file ./path/to/SKILL.md

# Clear the description specifically (empty string clears; omitting --description leaves it untouched)
npx @quanvo99/ai-rules@latest skill update <id> --description ""

# Delete a private skill permanently
npx @quanvo99/ai-rules@latest skill delete <id>
```

`skill update <id>` flags: `--name`, `--content` / `--content-file`, `--description`, `--scope` / `--global` — at least one is required. An unknown `<id>` on `update` or `delete` exits non-zero.

### 5. Pull

With the secret in the environment, pull brings down public skills plus your **global** private skills; add `scope` in config to also receive scoped ones:

```bash
npx @quanvo99/ai-rules@latest pull
```

`add` and `sync` thread the configured `scope` the same way — `sync` force-installs the full available catalog, so use it to reconcile a project to everything its scope unlocks.

### 6. Verify

- The private skill's files appear under the agent's skills path: `claude-code` → `.claude/skills/<name>/SKILL.md`, `cursor` → `.cursor/skills/<name>/SKILL.md`, `antigravity` → `.agents/skills/<name>/SKILL.md`.
- If nothing private arrived, run through the silent-failure checklist below.

## Troubleshooting (silent failures)

Private skills missing after a pull, with no error:

1. Is `AI_RULES_SECRET` actually available in the shell running the CLI? (`echo ${AI_RULES_SECRET:+set}` → should print `set`.)
2. Does the value match the server's secret **exactly**? The compare is byte-for-byte and constant-time; a trailing newline or quote breaks it.
3. Is `scope` present in `.ai-rules.json`, and does it intersect a scope the skill was uploaded under?
4. Is the CLI ≥ 0.2.0? Older versions ignore scope entirely.

## Safety

- The secret grants read access to every private skill in your scope — treat it like a password.
- Never commit it, never paste it into a skill body, never echo it in shared logs.
