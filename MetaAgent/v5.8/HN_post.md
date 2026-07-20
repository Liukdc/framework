# Show HN: State-Control — a deterministic context manager for LLM agents (not another prompt hack)

Every LLM agent framework optimizes the same thing: *what to feed the model*. Better prompts, richer tool orchestration, multi-agent coordination. All chase smarter context.

We built something that inverts the problem: **a deterministic outer loop that decides what the model SHOULDN'T see.**

Here's the problem we kept hitting: LLMs are terrible at knowing when to stop. Feed them a lot of conversation history, and they'll hallucinate connections between unrelated turns. Cross-session memory decays by recency, not by value. And when the model goes off-task, you can't audit *why* — it's all inside the black box.

Our answer: externalize all context-management decisions into a deterministic state machine. The LLM still reasons. But what enters its context window is decided by auditable, testable, version-controlled rules.

**Three mechanisms that made the difference**

**1. The Room Metaphor**

Every workflow node is a sealed room. The LLM inside Room N5 (scheduler) has no idea what was discussed in Room N1 (boundary definition). Each room gets its own constitution (injectable rules), conversation log, and turn history limit. Rooms inherit data via explicit contracts — never by accidental context bleed.

**2. TaskType Duality**

Agent tasks fall into exactly two categories. *field_based*: discrete parameter collection. Fields are enumerable, DET (deterministic) verification works, no semantic ambiguity. *topic_based*: continuous semantic exploration, embedding-guarded matching with deterministic keyword fallback. Knowing which type you're on changes everything about injection strategy.

**3. @importance: Critical Rooms Get Bigger Windows**

Not all conversation history is equal. A critical room (state enumeration, root constitution) gets more history budget. A low-importance room gets less. Truncation is deterministic — the oldest turns in low rooms drop first, zero LLM involvement.

**Eating our own dog food**

We used the methodology to build MetaAgent — an agent that guides users through designing agents using the same methodology. 18 intents, 16 room constitutions, a full L3 config package. As a side effect, we ended up with a reusable SDK: `createAgent()` loads any L3 config and runs.

**Try it**

```
npm install metaagent-v5
```

```js
import { createAgent } from 'metaagent-v5';

// Zero-config — no API key needed (mock mode)
const agent = await createAgent();

// Or with real model
const agent = await createAgent({ apiKey: 'sk-xxx' });

await agent.startSession('demo');
const r = await agent.sendMessage('Design an accounting assistant for me');
```

**Tests:** Full test coverage on state machine, route table, context manager, and degradation chain. [Architecture docs](https://liukdc.github.io/framework) · [Repo](https://github.com/Liukdc/framework/tree/main/MetaAgent/v5.8)

This is the result of iteration across a pending patent and real-world testing. If you've hit context bloat or untraceable agent decisions in production — I'd love to hear how this holds up against what you've tried.
