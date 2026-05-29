# Brainstorm: AI-Driven Kanban Board

## Problem Statement

I want an app where a **Kanban board** is worked on **autonomously by AI coding agents**. The board has 4 columns:

- **Todo** — tasks waiting to be picked up
- **In Progress** — an agent is actively working
- **Need Review** — agent finished but a human must review (WIP column owned by the user); each card links to the **claude.ai chat session** so I can inspect what was done
- **Done** — completed and accepted

A scheduler **periodically** scans the Todo column, picks up tasks (e.g. linked to a PR / work item), spins up an agent session to address them, then moves the card to **Done** (if confident) or **Need Review** (if human review needed).

The board must **expose an API or MCP server** so the AI agent can move tickets between columns programmatically.

**Key open question:** Should this be built from scratch, or can we reuse / fork an existing tool?

---

## Context & Current State

- Greenfield. No code yet.
- Single-user (me) initially.
- Target agent is Claude Code / claude.ai sessions.
- Personal workflow tool — I want to delegate coding tasks to agents and review the results asynchronously.

---

## Market Research Findings (see [research summary](#market-research-summary))

**This category already exists and is mature (late 2025 / early 2026).** Building a kanban board from scratch is likely wasted effort. Top candidates:

| Product                     | Type           | Board?           | API/MCP?         | Claude Code?       | Fit                                                                             |
| --------------------------- | -------------- | ---------------- | ---------------- | ------------------ | ------------------------------------------------------------------------------- |
| **Vibe Kanban** (BloopAI)   | OSS Apache-2.0 | ✅               | ✅ MCP           | ✅ first-class     | ⭐ Best fit — but upstream now community-maintained (Bloop shut down ~Apr 2026) |
| **kanban-code** (LangWatch) | OSS AGPLv3     | ✅ (Todo→…→Done) | CLI/JSON         | ✅ deep            | High, but desktop-only + AGPL                                                   |
| **Cline Kanban**            | OSS            | ✅               | ✅ MCP+SDK       | ✅                 | High, heavier all-in-one                                                        |
| **Backlog.md**              | OSS MIT        | ✅ term+web      | ✅ MCP built-in  | ✅                 | High — tasks as markdown-in-git, no server DB                                   |
| **Conductor / Terragon**    | SaaS           | ~dashboard       | partial          | ✅                 | Low (not self-hostable)                                                         |
| **Linear for Agents**       | SaaS           | ✅               | ✅ API+MCP       | via integrations   | Medium (not self-hosted, not Claude Code)                                       |
| **Kanboard / Wekan**        | OSS MIT        | ✅               | ✅ REST/JSON-RPC | build MCP yourself | Medium                                                                          |

**Recommendation from research:** Fork **Vibe Kanban** (closest match) OR pair a permissive OSS board (Kanboard/Backlog.md) with a thin MCP + scheduler. Do NOT build the board from scratch.

---

## Constraints & Requirements (to be refined via clarifying questions)

- Self-hostable / local-first preferred (TBD)
- Must support Claude Code as the agent
- Must expose API or MCP for card movement
- "Need Review" cards link to a claude.ai session
- Periodic/scheduled autonomous pickup

---

## Clarifying Questions & Answers

1. **Reuse vs build from scratch?** → _Explore all paths_ (undecided). See [solutions doc](./brainstorm-ai-kanban-solutions.md).
2. **Where do tasks originate?** → A **UI to add tasks manually**. Two task kinds:
   - **One-time tasks**
   - **Recurring tasks** — e.g. "check a Notion page for tasks and pick the top 2 priority ones." So the system needs a **recurring scheduler** that can **pull candidate work from external sources (Notion)** and select top-N by priority.
3. **Execution model?** → **Local Claude Code for now**, BUT must **enable remote control of that session**.
4. **claude.ai session link importance?** → **Must be claude.ai** — I review mostly on my **phone**, so a claude.ai-viewable session is essential.
5. Solo tool initially.

### 🔑 Key Architectural Finding: Claude Code "Remote Control"

Research confirms Claude Code has a **Remote Control** feature (v2.1.51+, Pro/Max, research preview ~Feb 2026) that is an almost-exact fit:

- Session **runs locally** (full filesystem + MCP access) but is **viewable AND steerable from claude.ai/code and the mobile app**.
- Outbound HTTPS only (no inbound ports); generates a **session URL + QR** → this becomes the **claude.ai link on the "Need Review" card**.
- Phone can: read transcript/tool output, send messages, view diffs, leave inline comments, approve permissions.

**Constraints that shape the design:**

- The local CLI process / machine **must stay online** for the session to remain reachable (~10-min network timeout). → A "Need Review" card's session must be kept alive locally, or archived.
- **Server mode** supports multiple concurrent sessions.
- For fully headless scheduled runs that finish while I'm away, pair with `claude -p` / Agent SDK + session **export/archival**, then surface via Remote Control or a stored transcript.

Sources: [Remote Control docs](https://code.claude.com/docs/en/remote-control.md), [Headless](https://code.claude.com/docs/en/headless), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview.md), [Claude Code on web](https://code.claude.com/docs/en/web-quickstart.md).

---

## Market Research Summary

Full table and source URLs are preserved in the conversation; key sources:

- Vibe Kanban: https://github.com/BloopAI/vibe-kanban
- kanban-code: https://github.com/langwatch/kanban-code
- Backlog.md: https://github.com/MrLesk/Backlog.md
- Claude Code Agent Teams: https://code.claude.com/docs/en/agent-teams
- Linear for Agents: https://linear.app/agents

---

## Zoom Levels (to be developed after clarification)

- Layer 1: Build vs Reuse vs Hybrid — _pending_
- Layer 2: Architecture of chosen path — _pending_
- Layer 3: Implementation details — _pending_
