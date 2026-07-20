# 态控架构 (State-Control Architecture)

> **Not making AI smarter — making AI compute only what it should.**  
> 不是让 AI 更聪明，是让 AI 在精确限定的条件下，只算该算的东西。

[English](#english) | [中文](#chinese)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21435111.svg)](https://doi.org/10.5281/zenodo.21435111)

<a id="english"></a>
## English Abstract

### What is State-Control?

State-Control (态控, Tàikòng) is a **deterministic context-management methodology** for LLM-based agent systems. It shifts the "what-to-inject-into-context" decision from the LLM's internal reasoning to an external, auditable state machine — reducing token waste, preventing hallucination from context pollution, and providing a complete audit trail.

**The Secretary Metaphor:** State-Control is the LLM's executive secretary. The secretary doesn't make the boss's decisions — but decides which documents land on the desk first, which calls get through, which meetings go on the calendar. And critically: the secretary has autonomous authority over security — screening visitors (degradation chain), blocking spam calls (M1 exact-match routing), and following the fire manual without asking (hardcoded fallback). **The more expensive the boss's time, the more money the secretary saves — not by being smarter, but by ensuring the boss only spends time on things that matter.**

### Architecture — Three-Body Separation

State-Control splits the agent system into three independent components:

- **Scheduler (DET)**: Routing + full-audit logging + resource coordination. 0 LLM calls for state transitions.
- **Context Manager (DET)**: Three-layer deterministic pipeline — match rules → decide what to inject → assemble prompt. Never executes constitutions, only assembles context.
- **LLM Model**: Handles in-room interaction — intent recognition, field collection, content generation. The only component that uses probability reasoning.

Core discipline: **deterministic tasks to deterministic programs, probabilistic tasks to probabilistic models.**

### Core Mechanisms

| Mechanism | Description |
|-----------|-------------|
| TaskType Duality | `field_based` (discrete, DET-verifiable) vs `topic_based` (continuous, embedding-guarded) |
| Room Isolation | Each workflow stage is an isolated room — the LLM sees only that room's context. Cross-room KV cache is released, shared stable prefix is preserved. |
| Three-Tier Constitution | Root (immutable 4 clauses) → Step Constitution → Domain Rules (L0-L3 permission hierarchy) |
| 4-Stage Degradation Chain | L1 structural check → DET value-domain check → logprobs check → hardcoded fallback. All DET, 0 LLM. |
| TopicEvolution | Cross-session memory with layered retention (major preserved, minor compacted, invalid archived) |
| Hierarchical Tool Discovery | Required tools (in-context) → Tool catalog (lightweight) → Optional tools (on-demand). Two-Phase Selection. |
| Content-Differentiated S3 | Room switch releases only room-specific KV cache; shared stable prefix (root constitution, global rules) stays cached. |

### Latest Release: v5.8

Published July 2026. Based on the structure: **1 overview + 12 detailed specs + changelog**.

```
framework/
├── 总纲v5.8/                     # Architecture specification (12 detail files)
├── 流程指南v8.2/                 # Design methodology guide (7 detail files)
├── 节点说明/                     # Node-by-node design instructions (P0 → N15, 38 files)
├── agents/                       # Reference implementations
│   ├── fugui-xiaoan/              # Smart accounting assistant (8,500+ lines, field_based + topic_based)
│   └── zacuiben/                  # Text fragment manager (3,200+ lines)
├── tools/                        # Tool layer
│   ├── big-ears/                  # Non-intrusive voice input
│   ├── proofreader/               # Input pre-calibration
│   ├── whiteboard/                # Process-isolated canvas
│   ├── comparison-mirror/         # Modification quality gate
│   ├── xiaoshan/                  # Micro text editor
│   └── screen-officer/            # Non-intrusive reading workbench
├── archive/                      # Historical versions
├── CHANGELOG.md                  # Complete v4.7 → v5.8 changelog
└── README.md                     # This file
```

### MetaAgent: Reference Implementation

`@exomind/metaagent` v5.8.0 — a complete Node.js implementation of the State-Control architecture. 2,055 lines of core code, 11 integration tests passing, 0 npm test failures.

```bash
npm test  # 11 tests, 3 suites, all passing
```

### Citation

```bibtex
@misc{liu2026-state-control,
  title   = {State-Control Architecture: Deterministic Context Management for LLM Agent Systems},
  author  = {Jinsong Liu},
  year    = {2026},
  doi     = {10.5281/zenodo.21435111},
  url     = {https://github.com/Liukdc/framework}
}
```

<a id="chinese"></a>
## 中文正文

### 态控是什么

态控（态控架构，State-Control Architecture）是一套**确定性的 LLM Agent 上下文管理方法论**。核心思想：把"喂给 LLM 什么上下文"这件事，从 LLM 内部的黑箱推理变成外部可审计的确定性状态机。每一条注入上下文的记忆、规则、历史，都有可追溯的理由。

**一句话理解：态控架构就是模型的秘书。**

秘书不替老板做决策，但秘书决定：什么文件先放到桌上、什么电话先接、什么会议排几点。而且，秘书有老板也绕不开的自主权限——安检来访者（降级链）、拦推销电话（M1 口令层）、火灾时按消防手册处理不请示（硬编码兜底）。**老板的时间越贵，秘书省的钱越多——不是因为秘书更聪明，是因为老板的时间不能花在不值得的事上。**

### 态控解决了什么问题

现有 Agent 框架（LangGraph、CrewAI、Coze、Dify 等）的核心思路是"让 LLM 更聪明"——更好的 prompt + 更强的工具编排 + 多 Agent 协作。但 LLM 本质是一个无状态的、注意力资源有限的概率计算工具，上下文越长，噪音越多，成本越高，结果越不可控。

态控的做法不同：**不是优化该喂什么，而是明确不该喂什么。**

### 核心机制一览

| 机制 | 一句话 |
|------|--------|
| taskType 双模式 | field_based（离散字段，DET 可验）vs topic_based（连续语义，embedding 守卫）|
| 房间隐喻 | 每个环节是独立房间，切换时只释放环节独有内容，稳定前缀保留跨房间共享 |
| 三体分工 | 调度器（路由+记录）→ 上下文管理器（匹配→决策→拼接）→ LLM（环节内交互）|
| 三层宪法 | 根宪法（不可变 4 条）→ 环节宪法 → 领域规则（L0-L3 权限分层）|
| 四项降级链 | L1 结构校验 → DET 值域复验 → logprobs 置信度 → 硬编码兜底。全部 DET，0 LLM |
| 工具分层发现 | 必用工具（常驻）+ 工具清单（轻量目录）+ 选用工具（按需加载），Two-Phase Selection |
| 内容区分 S3 | 切换环节释放环节独有 KV Cache，保留全局稳定前缀 |

### 最新版本：v5.8

2026 年 7 月发布。1 份概要总纲 + 12 份细则文件 + 独立变更日志。

```
framework/
├── 总纲v5.8/                     # 态控架构本体（12 细则 + 1 概要）
├── 流程指南v8.2/                 # 设计流程指南（7 细则）
├── 节点说明/                     # P0→N15 节点级设计指导（38 文件）
├── agents/                       # 参考智能体实现
│   ├── fugui-xiaoan/              # 富贵小安（8500+ 行，field/topic 双模式）
│   └── zacuiben/                  # 杂碎本（3200+ 行）
├── tools/                        # 工具层（6 个，设计阶段）
│   ├── big-ears/                  # 大耳朵——非侵入式语音输入
│   ├── proofreader/               # 校对哨兵——输入预校准
│   ├── whiteboard/                # 白板——过程隔离协同
│   ├── comparison-mirror/         # 对照镜——修改质量闸门
│   ├── xiaoshan/                  # 小山——微观文本编辑
│   └── screen-officer/            # 屏幕官——沉浸阅读工作台
├── archive/                      # 历史版本归档
├── CHANGELOG.md                  # v4.7→v5.8 完整变更记录
└── README.md                     # 本文件
```

### MetaAgent：完整代码实现

`@exomind/metaagent` v5.8.0——态控架构的 Node.js 生产级实现。2055 行核心代码，11 个集成测试全部通过。

```bash
npm test  # 11 tests, 3 suites, 全绿
```

包含：调度器（377 行）、上下文管理器、contractStore、状态机、路由表、工具注册表、DeepSeek 适配器、可调参数、遥测、L2-L3 校验器、N14 审骨架工具链。

### 引用

```
刘劲松. 态控架构：面向 LLM Agent 系统的确定性上下文管理方法论. 2026.
DOI: 10.5281/zenodo.21435111
```

### 作者

听风者（Jinsong Liu）— 深圳 · 产品经理 / 全栈开发者

> 文档版本：v3.0
> 日期：2026-07-20
> 更新：对齐 v5.8 总纲 + metaagent 代码实现 + 六工具清单 + 文档站上线
