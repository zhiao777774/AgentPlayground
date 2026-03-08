---
name: km-agent-creator
description: Create a new Knowledge Management Agent (or reuse an existing one) under `agents/` to help users complete Knowledge Management workflows such as lessons learned capture, RFQ generation, summary report generation, knowledge Q&A, and deep research. Use this skill whenever the user asks to set up, scaffold, bootstrap, or standardize a KM agent/project; when they mention “knowledge management agent”, “KM agent”, “agent template”, “create an agent in agents/”, or want a reusable agent for organizational knowledge tasks. This skill is especially appropriate when the user wants repeatable workflows, structured artifacts (AGENTS/MEMORY/IDENTITY/USER), and iterative testing with example input/output pairs.
---
# KM Agent Creator

This skill scaffolds a **Knowledge Management Agent** project in `agents/` using the templates in `assets/templates/`, then iteratively validates it with user-provided test cases (input/output pairs) before the agent is used for real tasks.

## Goals

- Create (or reuse) a KM Agent workspace with consistent structure.
- Capture the user’s task goal and preferences into the right files.
- Validate via test cases, iterating until the user accepts results.
- Enable a stable “main flow” for recurring KM tasks.

## Scope of KM tasks this agent may support

- Lessons Learned (postmortems, retrospectives, RCA summaries)
- RFQ / RFP generation (structured requirement documents)
- Summary report generation (executive summaries, weekly/monthly reports)
- Knowledge Q&A (grounded answers from internal materials)
- Deep Research (multi-step research + synthesis)

## Assumptions

- Repository layout includes:
  - `agents/` (existing agent projects live here)
  - `assets/templates/` (template files to copy into new agent projects)
- The agent project folder contains Markdown files like:
  - `SOUL.md`, `AGENTS.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`
  - (and possibly other `.md` template files)

---

## 1) Pre-flight Setup

Follow this checklist in order. Keep the user informed of what you’re doing and why, and ask concise questions whenever you need missing details.

### 1. Ask the user for the task objective

Ask:

- What is the exact KM task you want this agent to do?
- What are the expected outputs (format, sections, tone, length)?
- What are the inputs usually like (docs, chat logs, spreadsheets, PDFs, links)?
- Any constraints (language, confidentiality boundaries, citation requirements, timeline)?

Write down a crisp “task objective” summary in your working notes; you’ll later put it into `AGENTS.md`.

---

### 2. Check whether a similar agent already exists in `agents/`

Steps:

1. Inspect `agents/` directory for existing agent projects.
2. Compare the user’s objective to existing agents’ purpose (by folder name and/or reading their `AGENTS.md`).

Ask the user:

- “I found an existing agent that looks similar: `<candidate-agent>`. Do you want to reuse it, or create a new one?”

If **reuse existing**:

- Skip folder creation and template copying.
- Continue with steps that update files and run test cases, using the chosen existing agent folder.

If **create new**:

- Continue to the next step.

---

### 3. Ask for a project name (must be unique)

Ask the user for a short project name and validate:

- Must not duplicate an existing folder name in `agents/`.
- Must be convertible to **lowercase kebab-case**: `xxx-xxx`.
  - Examples: `rfq-writer`, `lessons-learned`, `km-deep-research`

If the user provides a name that conflicts or cannot be safely converted:

- Propose 2–3 alternative kebab-case options and ask them to pick one.

---

### 4. Create the agent folder under `agents/`

Steps:

1. Create `agents/<project-name>/` where `<project-name>` is all lowercase kebab-case.
2. Confirm the folder exists.

---

### 5. Copy templates into the new folder

Steps:

1. Copy everything from `assets/templates/` into `agents/<project-name>/`.
2. Preserve subfolders and filenames.

---

### 6. Read all `.md` files you just copied

Steps:

1. Enumerate all `.md` files inside `agents/<project-name>/`.
2. Read each file to understand:
   - What it is for
   - What principles it enforces
   - What information should be stored there
3. Build a quick mental map of which file should be updated for which kind of user feedback.

---

### 7. Write the task objective into `AGENTS.md`

Steps:

1. Open `AGENTS.md`.
2. Insert or update a clear “Task Objective” section containing:
   - The user’s KM objective (what the agent must achieve)
   - Expected deliverables (artifacts and formats)
   - Guardrails (what not to do)

Keep it short, specific, and action-oriented.

---

### 8. Collect basic user info and preferences; write into `USER.md`

Ask only what matters for this agent:

- Preferred language(s)
- Preferred output style (bullets vs narrative, formal vs casual)
- Domain context (industry/team context, audience)
- Formatting preferences (headings, tables, citations)
- Any recurring constraints (time, compliance, redaction rules)

If the user provides these details:

- Write them into `USER.md` in a structured way.

---

### 9. Ask the user for multiple test cases (input + expected output)

Request **a set of test cases**, not just one:

- At least 3 cases if possible.
- Each test case must include:
  - **Input**: the raw content or a representative snippet
  - **Expected Output**: what “good” looks like (structure + key points)

If the user can’t provide full outputs, accept:

- A rubric (must-include items, forbidden items, success criteria).

---

### 10. Run the task freely on the test cases (iterative, user-in-the-loop)

For each test case:

1. Restate the **Input** and the **Expected Output** in your own words.
2. Decompose the task into steps; execute the steps to produce an output.
3. If anything is ambiguous:
   - Ask the user immediately with a short, specific question.
4. As you learn from clarifications and feedback, update the appropriate files:
   - Update `MEMORY.md` with durable, reusable learnings and constraints.
   - Update `IDENTITY.md` with stable agent identity/role principles (if applicable).
   - Update `USER.md` with user-specific preferences.
   - Update `AGENTS.md` if the objective or deliverable definition changes.

Important:

- Do not “silently assume” missing requirements during testing.
- Always prefer a brief question over guessing when the ambiguity would change the output meaningfully.

---

### 11. Summarize test results and iterate until accepted

After all test cases:

1. Provide a detailed test report:
   - For each case: what you produced, what matched, what diverged, and why
   - Known limitations / open questions
   - Proposed updates to agent behavior
2. Ask the user:
   - “Do you have feedback or changes you want?”
3. If feedback exists:
   - Incorporate it
   - Update the relevant `.md` files (`AGENTS.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`, etc.)
   - Re-run the full test set (or at least the cases affected by the change)
4. Repeat until the user says the agent is usable.

**Final Context Switch**:
- Once the user accepts the new agent, you MUST immediately call the `switch_agent_routing` tool with the new `<project-name>`.
- This ensures the user's chat interface is permanently bound to this new agent for all future conversations.

**Exit condition for Pre-flight Setup**:

- The user explicitly confirms the outputs are acceptable on the provided test cases.
- You have called `switch_agent_routing` to set the new context.

---

## 2) Main Workflow

Only use this section after Pre-flight Setup is completed and the user has accepted test-case performance.

### 1. Read the agent’s core files carefully

Before doing any real work, read:

- `SOUL.md`
- `AGENTS.md`
- `MEMORY.md`
- `IDENTITY.md`
- `USER.md`

Internalize:

- Objective and deliverables
- Agent behavior constraints
- User preferences
- Any “always/never” rules encoded in the templates

---

### 2. Execute the user’s current task

Steps:

1. Ask for (or confirm) the current task input(s).
2. Decompose the task into a clear plan.
3. Execute the plan to produce outputs aligned with:
   - `AGENTS.md` (objective + deliverables)
   - `USER.md` (preferences)
   - `SOUL.md` / `IDENTITY.md` (behavioral principles)
   - `MEMORY.md` (learned constraints and recurring patterns)

---

### 3. Incorporate feedback and continuously maintain the agent files

Whenever the user provides feedback:

1. Decide which file(s) should be updated based on template intent:
   - **MEMORY.md**: durable learnings, constraints, reusable domain rules
   - **AGENTS.md**: objective, deliverable definitions, workflow changes
   - **IDENTITY.md**: stable role/voice/operating principles
   - **USER.md**: user-specific preferences
2. Update the file(s) with concise, non-duplicative entries.
3. Continue the task with the updated guidance.

Keep changes minimal but meaningful:

- Avoid bloating files with one-off notes.
- Prefer general rules that will help future runs.
