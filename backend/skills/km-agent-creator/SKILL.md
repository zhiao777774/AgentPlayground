---
name: km-agent-creator
description: Create a new Knowledge Management Agent (or reuse an existing one) under `agents/` to help users complete Knowledge Management workflows such as lessons learned capture, RFQ generation, summary report generation, knowledge Q&A, and deep research. Use this skill whenever the user asks to set up, scaffold, bootstrap, or standardize a KM agent/project; when they explicitly say phrases like "create an agent", "build a new assistant", "I need an agent to do X", "make a reusable workflow", "agent template", or want a reusable space for organizational knowledge tasks. Do NOT trigger this if the user is merely asking a general programming question about AI frameworks. Make sure to use this skill actively to establish a rigorous, repeatable workflow with structural memory integration.
---
# KM Agent Creator

This skill empowers you to scaffold and structure a **Knowledge Management Agent** project in `agents/`.
Your primary goal is not just to create a folder, but to **build a permanent, reliable brain** for the user's KM workflows (e.g., Lessons Learned, RFQ writing, Report generation).

## 🧠 The Golden Rule: Ephemeral Chat vs. Permanent Brain

As sessions grow long, chat history will inevitably be truncated or compressed, and you **will forget** important instructions if they only exist in conversation.

**CRITICAL DIRECTIVE**: You must proactively act to push all objectives, preferences, and constraints into the core `.md` files immediately. **Do not just say "Got it" or "I'll remember that". Write it down!**

* **If the user says:** *"When generating the RFQ, always cross-reference my `Q4_Sales_Template.xlsx`."*
  * ❌ *Wrong:* "Understood, I will use that template from now on."
  * ✅ *Right:* Actively append this exact constraint into `MEMORY.md` immediately, so the knowledge persists seamlessly across future sessions.

### Where Should Knowledge Be Stored?

Because context bootstrapping injects these files into your context automatically on every request, keeping them updated is all you need to do to maintain perfect memory:

- **`AGENTS.md`**: The grand target. What is the overarching objective? What are the required final deliverables?
- **`MEMORY.md`**: Permanent domain facts, formatting rules, user-requested tool constraints (e.g., "Must format the output as a Markdown table" or "Always refer to X document").
- **`memory/<YYYY-MM-DD>.md`**: Short-term memory files for the current date. Use these to store intermediate scratchpad data, volatile task states, or day-to-day context that needs to survive across sessions but shouldn't pollute the permanent knowledge base.
- **`USER.md`**: Personal preferences, tone, language, and role-play instructions.
- **`IDENTITY.md`** & **`SOUL.md`**: Stable agent behavioral guidelines and core personas.

---

## 🏗️ The 4-Stage Workflow

You must rigorously and systematically walk the user through these 4 stages. Do not rush to the end. Proceed sequentially to ensure the agent is configured correctly.

### Stage 1: Intent Discovery (Guided Interview)

You need to construct a robust mental model of the new agent before building anything. You must act as a structured interviewer to help the user clarify their thoughts.

- **Interview Rules**:
  - **One question at a time**: NEVER bombard the user with a giant wall of questions. Ask ONE primary question, wait for the answer, briefly summarize their answer to confirm understanding, and only then proceed to the next question.
  - **Be Beginner-Friendly**: If the user is vague or unsure, provide 2 to 4 concrete options or examples to help them choose.
- **The Interview Funnel** (Walk through these iteratively):
  1. *Objective & Role*: What exactly does this agent need to accomplish? What persona should it adopt?
  2. *Background & Inputs*: What are the typical inputs (PDFs, URLs, chat, DB)? Are there contexts or team jargons the agent must know?
  3. *Expected Output & Success Criteria*: What is the exact format (table, markdown, prose)? What does a "perfect" output look like?
  4. *Constraints*: What must the agent AVOID doing? Are there strict limitations?
- **Propose a Name**: Once the interview is complete and the picture is clear, suggest a unique kebab-case `<agent-name>` (e.g., `rfq-writer`, `lessons-learned`).
- **Isolation Constraint**: You MUST use the `Current User`'s username from your System Prompt to form the physical directory name. 
- **Naming Rule**: The username part must be converted to **all lowercase**, and any underscores (`_`) must be replaced with hyphens (`-`). 
- **Format**: `{{lowercase-kebab-username}}--{{agent-name}}`.
- **Example**: If the user is `Mark_Hsu` and the agent name is `support-bot`, the directory will be `agents/mark-hsu--support-bot`.
- Ask if they prefer to reuse a similar existing agent in `agents/` or create a new one. Wait for approval.

### Stage 2: Scaffolding & Brain Implantation

Once the agent name and directory naming convention are approved:

- **Scaffold**: Create the `agents/{{lowercase-kebab-username}}--{{agent-name}}/` directory and copy all contents from `assets/templates/` into it exactly.
- **Implant the Brain**: Do not wait. Take the insights and constraints discussed in Stage 1 and immediately write them into `AGENTS.md`, `MEMORY.md`, and `USER.md`. This solidifies the mental model permanently.
- **Immediate Registration (CRITICAL)**: As the very last step of Stage 2, you **MUST** call the `switch_agent_routing` tool with the full directory name: `{{lowercase-kebab-username}}--{{agent-name}}`. This registers the agent in the database and ensures it is visible in the UI immediately.

### Stage 3: Stress Test & Performance Tuning (Native Environment)

Now that you have switched to the new agent's context, you must perform realistic dry-runs from within this "native" brain.

- **Request Examples**: Ask the user to provide 1 to 3 realistic Test Cases (input examples + a description of the expected output or success criteria).
- **Execute & Self-Correct**: As the newly formulated agent, autonomously execute the task and internally self-correct your work until you are confident the result closely matches the user's expected output or success criteria.
  - *Halt on Ambiguity*: If you encounter any critical ambiguity or missing pieces during execution, **do not guess silently**. Stop immediately, report your current progress, and ask the user for their opinion before proceeding.
- **Validate & Iterate**: Ask the user if the output matches their expectations.
  - *Human-in-the-Loop Optimization*: If the user corrects your output or adds a new constraint, immediately update the local `MEMORY.md` or `AGENTS.md` and rerun the task.

### Stage 4: Launch & Handover

- **Final Validation**: Once the user explicitly accepts the agent's behavior, confirm that all final instructions have been persisted.
- **Celebrate**: Inform the user that the agent is fully tested, registered, and ready for use.
- Yield control.
- Celebrate completion and yield control.

---

## Dealing With Ambiguity

- **Never guess silently**: If a requirement is missing during testing that significantly alters the output, ask the user.
- **Generalize the feedback**: When the user provides a correction on a specific test case, think about how to formulate it as a *general rule* in `MEMORY.md` rather than an overly specific rule for one file.
