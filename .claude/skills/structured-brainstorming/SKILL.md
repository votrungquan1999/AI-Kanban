---
name: structured-brainstorming
description: Facilitates structured brainstorming using zoom-out-first approach, research-first ideas and iterative thinking. Use when brainstorming solutions, designing systems, exploring approaches, or when user says "help me think through", "design this", "brainstorm", or "explore options".
---

# Structured Brainstorming

This Skill provides a structured approach to brainstorming and problem-solving using the zoom-out-first methodology with iterative refinement.

## Core Methodology

1. **Problem Definition** - Clearly state the problem at the top
2. **Research First** - Gather ideas with sources and lead the reply with them; no opening question rounds
3. **Zoom Out First** - Start with the widest view, then progressively zoom in
4. **Iterate** - Generate multiple alternatives, refine, and build upon ideas
5. **Document Everything** - Write to .md files for context preservation

---

## Phase 0: Establish the Task Workspace

**Before creating any brainstorming document**, establish where artifacts go:

- **If a caller gave you a working directory** (e.g. `<ws>` = `./tmp/<identifier>/`), use it.
- **Otherwise**, derive a **task identifier** — a ticket id from the request or branch (e.g. `JIRA-123`), else a short kebab-case slug from the topic — and state it in one line. Then use `<ws>` = `./tmp/<identifier>/` and create that directory.

Throughout this skill, `<ws>` refers to that working directory. Scoping brainstorm docs under `./tmp/<identifier>/` lets multiple brainstorms run in parallel without colliding.

**Before creating `<ws>` or writing anything, check whether it already holds artifacts from unrelated work.** If it does, **STOP and ask the user** how to proceed — never overwrite another task's artifacts.

---

## Phase 1: Problem Definition

**Create a brainstorming document** at `<ws>/brainstorm-[topic].md` (the task workspace from Phase 0)

**Include:**
- Clear problem statement at the top
- Current state and context
- Constraints and requirements
- Stakeholders and impact areas
- Initial hypotheses and potential solutions

**Document Structure:**
- Use markdown sections for organization
- Use markdown links to refer between sections for easy navigation
- Keep documents small and reasonable in size for readability

---

## Phase 2: Research First, Ideas First

**Gather ideas before asking anything.** Search the web, talks and podcast transcripts, tools and studies, and collect concrete ideas with their sources.

- **The reply opens with the ideas**: a short numbered list, one line each, with a source per idea. No framing paragraph, stats or "why it's worth building" before the list; supporting evidence goes after it or in the document.
- **Then your recommendation.**
- **Ask at most one question**, and only when the topic itself is ambiguous enough that research would go the wrong way; restate your reading in one line instead when you can.
- Note open scope, constraint or success questions in the brainstorming document as assumptions for the user to correct, rather than holding the ideas back for them.

---

## Phase 3: Zoom Out First Approach

**ALWAYS start with the widest possible view**

### Layer 1: Highest Level (Widest View)
- View the problem from the largest context
- Consider the broader system, industry, or domain
- Identify high-level approaches and alternatives
- Document tradeoffs, principles, and priorities

### Layer 2: Zoom In One Level
- Break down chosen high-level approach
- Add more detail and specificity
- Generate multiple alternatives at this layer
- Review and refine before going deeper

### Layer 3: Continue Zooming In
- Progressively add implementation details
- Validate assumptions at each layer
- Allow for backtracking when needed
- Build upon previous ideas

**Continue this pattern until reaching implementation details**

---

## Phase 4: Iterative Solution Thinking

**No need for perfect solutions at once**

### Iteration Process:
1. **Generate** - Create multiple solution alternatives
2. **Document Tradeoffs** - Write pros/cons for each alternative
3. **Define Principles** - What principles guide this solution?
4. **Set Priorities** - What's most important?
5. **Review & Refine** - Improve the solution before going deeper
6. **Validate Assumptions** - Check if assumptions still hold
7. **Backtrack if Needed** - Don't be afraid to revisit earlier layers

### At Each Layer:
- Generate at least 2-3 alternatives
- Document the reasoning for each
- Write up the alternatives for the owner; the owner picks which to pursue — you may recommend, but do not pick
- Once the owner picks, delete the rejected alternatives and keep a one-line Decision Log entry for each (what was rejected and why)

---

## Documentation Best Practices

### File Organization
- Create separate `.md` files for complex brainstorms, all inside the task workspace `<ws>`
- Split into multiple files when a single file grows too large
- Use descriptive filenames: `<ws>/brainstorm-authentication-approach.md`
- Link between files using markdown links

### Content Structure
```markdown
# Problem Statement
Clear, concise problem statement

## Context
Current situation, background, what led here

## Constraints
- Technical constraints
- Time/resource constraints
- Business constraints

## Zoom Level 1: [Highest Level View]
### Alternative 1: [Approach Name]
**Pros:**
- ...

**Cons:**
- ...

**Principles:**
- ...

### Alternative 2: [Approach Name]
...

### Decision (owner's pick): Alternative 1
**Reasoning:** ...

## Decision Log
- Rejected Alternative 2: [one-line reason]

## Zoom Level 2: [One Level Deeper]
[Breaking down Alternative 1]
...
```

### Keep Documents Modular
- Each file: small and reasonable in size for easy comprehension
- Cross-reference with markdown links
- Example: `For authentication details, see [auth-design.md](./auth-design.md)`

---

## Best Practices

### During Ideation
- ✅ Focus on quantity initially before quality
- ✅ Withhold criticism during idea generation
- ✅ Encourage wild and unconventional ideas
- ✅ Build on previous iterations
- ✅ Set clear objectives and maintain focus

### Visual Aids
When helpful, use:
- Lists for alternatives
- Hierarchies for system structure
- Flow diagrams for processes
- One bullet list per alternative for comparisons

### Examples
```markdown
## Authentication Alternatives Comparison

**OAuth 2.0**
- Security: high
- Complexity: high
- Cost: low
- Time: 3w

**JWT only**
- Security: medium
- Complexity: low
- Cost: low
- Time: 1w

**Sessions**
- Security: high
- Complexity: medium
- Cost: low
- Time: 2w
```

---

## When to Use This Skill

**Trigger phrases:**
- "Help me brainstorm..."
- "I need to design..."
- "Let's explore options for..."
- "Help me think through..."
- "What are different ways to..."
- "I'm trying to figure out how to..."

**Good for:**
- System design and architecture
- Problem-solving and solution exploration
- Feature planning and approach selection
- Technical decision making
- Exploring implementation alternatives

**Not good for:**
- Quick code fixes (use directly)
- Well-defined implementation tasks (use feature-dev-lite)
- Simple questions with clear answers

---

## Summary Workflow

0. **Establish the task workspace** `<ws>` = `./tmp/<identifier>/` (derive an identifier and state it in one line)
1. **Create brainstorming document** under `<ws>`
2. **Define problem clearly** at the top
3. **Research and lead with ideas** - idea list with sources first, then a recommendation; one question only if the topic is ambiguous
4. **Start zoomed out** - widest possible view
5. **Generate alternatives** at current zoom level
6. **Document tradeoffs, principles, priorities**
7. **Review and refine** solutions
8. **Zoom in one level** and repeat
9. **Iterate until reaching implementation details**
10. **Split into multiple files** if the document grows too large
11. **Use markdown links** to connect related documents

**Remember:** Start wide, zoom in progressively, iterate at each layer, document everything, and keep files modular for readability.
