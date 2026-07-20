# We Built a Deterministic Agent Runtime That Works Without an API Key

Every LLM agent framework I've seen optimizes the same thing: *what to feed the model*. Better prompts, richer tool orchestration, multi-agent coordination. All chase smarter context.

We built something that inverts the problem: **a deterministic outer loop that decides what the model SHOULDN'T see — packaged as a zero-dependency npm module you can run without an API key.**

```
npm install metaagent-v5
```

**The core insight**

LLMs are terrible at knowing when to stop. Feed them 50k tokens of history, and they'll hallucinate connections between things said three hours ago. Cross-session memory decays by recency, not by value. When the model goes off-task, you can't audit *why* — it's all inside the black box.

Our answer: externalize all context-management decisions into a deterministic state machine. The LLM still reasons. But what enters its context window is decided by auditable, testable, version-controlled rules.

**Three mechanisms that made the difference**

1. **The Room Metaphor.** Every workflow node is a sealed room. The LLM inside Room N5 (scheduler) has no idea what was discussed in Room N1 (boundary definition). Each room gets its own constitution, conversation log, and injection rules. Rooms pass data via explicit contracts — never accidental context bleed. This alone cut token waste ~60%.

2. **TaskType Duality.** Agent tasks fall into exactly two categories. *field_based*: discrete parameter collection with DET verification (e.g., "record expense: ¥25"). *topic_based*: continuous semantic exploration with embedding-guarded matching. Knowing which type you're in changes everything about injection strategy.

3. **@importance.** Not all history is equal. A critical room gets 2× history boost. A low-importance room gets 0.15×. Truncation is deterministic — the oldest turns in low rooms drop first, zero LLM involvement.

**Eating our own dog food**

The most fun part: we used the methodology to build MetaAgent — an agent that guides users through designing agents using the same methodology. 18 intents, 16 room constitutions, a full L3 config package. SDK `createAgent()` loads any L3 config and just works — we verified this by generating a 3-intent accounting assistant L3 on the fly and loading it in 3 seconds.

**What shipped today**

- **npm package:** `npm install metaagent-v5` — zero dependencies, mock mode works without API key
- **SDK:** `import { createAgent } from 'metaagent-v5'` — one function, any L3 config
- **Tests:** 65 unit tests covering state machine, route table, and context manager
- **Framework repo:** https://github.com/Liukdc/framework/tree/main/MetaAgent/v5.8 — full v5.8 architecture, constitutions, toolchain

**Why now**

The agent space converges on "bigger context windows = better agents." We think the answer is *controlled* context windows — every injected token has a documented reason, every degradation path is deterministic, and the LLM is a reasoning engine, not a context manager.

A year of iteration across a pending patent, a master's thesis, and multiple deployments. Released today. Feedback welcome.
