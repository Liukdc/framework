# We Built a Deterministic Context Manager for LLM Agents — Not a Smarter Prompt, a Smaller One

Every LLM agent framework I've seen (LangGraph, CrewAI, Coze, Dify) optimizes the same thing: *what to feed the model*. Better prompts, richer tool orchestration, multi-agent coordination. All of them chase smarter context.

We built something that does the opposite: **a deterministic outer loop that decides what the model SHOULDN'T see.**

Here's the problem we kept hitting: LLMs are terrible at knowing when to stop. Feed them 50k tokens of conversation history, and they'll find a way to hallucinate connections between things said three hours ago. Cross-session memory decays by recency, not by value. And when the model goes off-task, you can't audit *why* — it's all inside the black box.

So we built State-Control (https://github.com/Liukdc/framework), a methodology and runtime that externalizes context-management decisions into a deterministic state machine. The LLM still does reasoning. But what enters its context window is decided by rules you can audit, test, and version-control.

**Three mechanisms that made the difference:**

**1. The Room Metaphor**

Every "node" in the agent's workflow is a sealed room. The LLM inside Room N5 (the scheduler) has no idea what was discussed in Room N1 (boundary definition). Each room gets its own conversation log, its own constitution (injectable rules), and its own turn history limit. Rooms can inherit fields via explicit contracts — never by accidental context bleed.

This alone cut our token waste by roughly 60% compared to dumping full conversation history into every call.

**2. TaskType Duality**

We found that agent tasks fall into exactly two categories:
- **field_based**: discrete field collection (e.g., "record this expense"). Fields are enumerable, DET (deterministic) verification works, no semantic ambiguity.
- **topic_based**: continuous semantic exploration (e.g., "design a character"). Embedding-guarded anchor matching, with deterministic keyword fallback when the auxiliary LLM times out.

Knowing which type you're in changes everything. field_based tasks use exact field-name matching for context injection. topic_based tasks use two-stage retrieval (keyword coarse-filter → embedding fine-filter). No more treating every task like a semantic search problem.

**3. @importance: Critical Rooms Get Bigger Windows**

Not all conversation history is equal. We tag every room with an importance level (critical/high/normal/low). A critical room (like the state enumeration node that defines the entire agent skeleton) gets a 2× history boost. A low-importance room gets 0.15×. The context manager does this truncation *before* any semantic scoring — the oldest turns in low-importance rooms are dropped deterministically, with zero LLM involvement.

**The self-referential case study**

The most fun part: we applied the methodology to build MetaAgent — an agent that guides users through designing agents using the same methodology. It uses 16 field_based intents, 15 step constitutions, and a full L3 deployable package. Eating our own dog food revealed edge cases we'd never have caught otherwise.

**What's in the repo:**
- The full v4.7 framework: architecture doc, design guide, and 30+ node specifications
- Two production agents: a smart accounting assistant (fugui-xiaoan) and a minimal text fragment manager (zacuiben) — both with live demos
- MetaAgent, the self-referential design assistant
- A context-manager implementation spec with pseudocode

**Live demos:** https://liukdc.github.io/framework/

**Why this matters now**

The agent space is converging on "bigger context windows = better agents." We think the better answer is *controlled* context windows — where every injected token has a documented reason, every degradation path is deterministic, and the LLM is treated as a reasoning engine, not a context-management engine.

Happy to discuss. This is the result of a year of iteration across a pending patent, a master's thesis, and two production deployments. All feedback welcome.
