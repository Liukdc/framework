# 态控架构 (State-Control Architecture)

> **Not making AI smarter — making AI compute only what it should.**  
> 不是让 AI 更聪明，是让 AI 在精确限定的条件下，只算该算的东西。

[English](#english) | [中文](#chinese)

---

<a id="english"></a>
## English Abstract

### What is State-Control?

State-Control (态控, Tàikòng) is a **deterministic context-management methodology** for LLM-based agent systems. It shifts the "what-to-inject-into-context" decision from the LLM's internal reasoning to an external, auditable state machine — reducing token waste, preventing hallucination from context pollution, and providing a complete audit trail.

**The Secretary Metaphor:** State-Control is the LLM's executive secretary. The secretary doesn't make the boss's decisions — but decides which documents land on the desk first, which calls get through, which meetings go on the calendar. And critically: the secretary has autonomous authority over security — screening visitors (degradation chain), blocking spam calls (M1 exact-match routing), and following the fire manual without asking (hardcoded fallback). **The more expensive the boss's time, the more money the secretary saves — not by being smarter, but by ensuring the boss only spends time on things that matter.**

### Core Innovation

Most agent frameworks (LangGraph, CrewAI, Coze, Dify) focus on making LLMs *smarter* through better prompts, tool orchestration, or multi-agent coordination. State-Control inverts the problem: **don't optimize what goes in — eliminate what shouldn't.**

The result is a system where:
- Every piece of context injected into the LLM has a documented reason
- Cross-session memory decays by "information net value," not by recency
- Hallucination from boundary violation is intercepted before reaching the user
- The entire design (from requirements to L3 deployable package) is traceable

### Architecture Layers

| Layer | Name | Purpose |
|-------|------|---------|
| L1 (Ground) | `framework/态控架构-v4.7-全量版.md` | Why — mechanisms, principles, constraints |
| L2 (Design) | `framework/态控闭环系统设计流程指南_v7.3.md` | How — methodology, checklists, step-by-step |
| L3 (Output) | `framework/节点说明_v5.4.md` + P0/N1-N16 | What — each node's inputs, outputs, deliverables |
| Application | `MetaAgent/` | Worked example: an agent that designs agents |

### Implemented Products

Two complete products built on State-Control, from L2 design documents through L3 constitutions to runnable code:

| Product | Version | Description | Lines |
|---------|---------|-------------|-------|
| `fugui-xiaoan/` | v4.0 | Smart accounting assistant — NLU-intent routing → 7 session constitutions → runtime state machine with 5-stage degradation chain | 8,500+ |
| `zacuiben/` | v2.1 | Sundries-book — lightweight text fragment manager with protector/scheduler/storage quad-set | 3,200+ |

Both include: L2 flow documents, L3 constitutions, context-manager implementations, turnType schemas, tunable parameters, unit + integration tests, and Capacitor hybrid-app builds.

### Key Mechanisms

- **TaskType Duality**: `field_based` (discrete field collection, DET-verifiable) vs `topic_based` (continuous semantic exploration, embedding-guarded)
- **Room Metaphor**: Each "node" is a room — the LLM only sees what's inside its current room
- **TopicEvolution**: Cross-session memory with layered retention (major events preserved, minor events compacted, invalid events archived)
- **4-Layer Constitution**: Root (immutable) → Public Rules → Step Charters → Runtime Context
- **@importance Three-Tier**: critical / high / normal / low — allocates token budget by information value
- **5-Stage Degradation Chain**: L1 structural check → DET value-domain check → confidence check → cross-task extension check → hard-coded fallback
- **cross_param Validation**: 5 inter-parameter semantic dependency rules that catch misconfiguration before deployment

### MetaAgent: The Self-Referential Case Study

The `MetaAgent/` directory contains a complete application of State-Control to build an agent that *guides users through designing agents using State-Control*. This self-referential case study demonstrates:

- 16 field_based intents, N2 skipped (pure field-collection scenario)
- 15 step constitutions with @importance tagging
- L3 deployable package (26 files including session constitutions, turnType schema, boundary list)
- Full traceability from P0 (cognitive loading) through N15 (delivery)

### Patent

This work is covered by a pending patent application for AI agent scheduling methods. All materials in this repository are open for academic and research use.

### Citation

```bibtex
@misc{liu2026-state-control,
  title   = {State-Control Architecture: Deterministic Context Management for LLM Agent Systems},
  author  = {Jinsong Liu},
  year    = {2026},
  url     = {https://github.com/Liukdc/framework}
}
```

---

<a id="chinese"></a>
## 中文正文

### 态控是什么

态控（态控架构，State-Control Architecture）是一套**确定性的 LLM agent 上下文管理方法论**。核心思想：把"喂给 LLM 什么上下文"这件事，从 LLM 内部的黑箱推理变成外部可审计的确定性状态机。每一条注入上下文的记忆、规则、历史，都有可追溯的理由。

**一句话理解：态控架构就是模型的秘书。**

秘书不替老板做决策，但秘书决定：什么文件先放到桌上、什么电话先接、什么会议排几点。而且，秘书有老板也绕不开的自主权限——安检来访者（降级链）、拦推销电话（M1 口令层）、火灾时按消防手册处理不请示（硬编码兜底）。**老板的时间越贵，秘书省的钱越多——不是因为秘书更聪明，是因为老板的时间不能花在不值得的事上。**

### 态控解决了什么问题

现有 agent 框架（LangGraph、CrewAI、Coze、Dify 等）的核心思路是"让 LLM 更聪明"——更好的 prompt + 更强的工具编排 + 多 agent 协作。但 LLM 本身有固有问题：

- **上下文窗口膨胀**：记忆无限堆叠，token 浪费在先，遗忘在后
- **串台**：跨场景信息混入当前上下文，LLM 在错误的规则下推理
- **边界模糊**：语义上没有确定的"该不该接这个活"的判决边界
- **不可审计**：为什么喂这段上下文？为什么拒绝那个请求？全在 LLM 内部

态控的做法不同：**不是优化该喂什么，而是明确不该喂什么。**

### 三层文档体系

| 层 | 文档 | 定位 | 字数 |
|----|------|------|------|
| L1 总纲 | `态控架构-v4.7-全量版.md` | 机制原理、约束规范 | ~20K |
| L2 流程 | `态控闭环系统设计流程指南_v7.3.md` | 设计方法论、检查清单 | ~30K |
| L3 工序 | `态控闭环系统人机设计流程_节点说明_v5.4.md` + P0/N1-N16 | 每步的输入输出、交付物、校验 | ~80K |
| 案例 | `MetaAgent/` | 完整落地案例：用态控设计一个"帮人用态控设计 agent"的助手 | — |

### 核心机制一览

| 机制 | 英文 | 一句话 |
|------|------|--------|
| taskType 二分法 | TaskType Duality | field_based（离散字段，DET 可验）vs topic_based（连续语义，embedding 守卫） |
| 房间比喻 | Room Metaphor | 每个节点是独立房间，LLM 只看当前房间内的上下文，不串台 |
| topicEvolution 分层留存 | TopicEvolution | 跨会话记忆按"信息净价值"衰减——major 永久保留，minor 超阈值压缩，invalid 归档 |
| 四层宪法 | Constitution Layers | 根宪法（不可变）→ 公共规则 → 环节宪法 → 运行时，逐层约束 |
| @importance 三层 | @importance | critical / high / normal / low — 有限的 token 预算按信息价值分配 |
| 五项降级链 | Degradation Chain | L1 结构 → DET 值域 → confidence → 跨任务延伸 → 硬编码兜底 |
| cross_param | cross_param | 5 条跨参数语义依赖规则，防止参数配置冲突 |
| 契约传递 | Contract Inheritance | 节点间字段级信息传递，防止上下文膨胀 |

### MetaAgent：自举案例

`MetaAgent/` 是态控的完整落地案例。它回答了一个自指问题：**"能不能用态控方法论造一个引导用户使用态控方法论的智能体？"**

结果是可以。整个设计流程（P0→N1→N3→...→N15）全部走完，产出：
- 16 个 field_based intent，N2 跳过（纯字段场景，字段即边界）
- 15 份环节宪法，每份含 @importance 优先级标注
- L3 可部署包（26 个文件）
- N10 tunable 参数清单（18 通用 + 1 field_based 专用）
- N13 骨架代码（10 个 .js 文件 + 21 条架构决策）
- 全部可溯源，从 P0 认知加载到 N15 交付

### 落地产品

两个基于态控架构的完整产品，从 L2 设计文档→L3 宪法→可运行代码，全链路打通：

| 产品 | 版本 | 说明 | 规模 |
|------|------|------|------|
| `fugui-xiaoan/` 富贵小安 | v4.0 | 智能记账助手 — NLU 意图路由→7 份 session 宪法→状态机 runtime，含五项降级链完整实现 | 8,500+ 行 |
| `zacuiben/` 杂碎本 | v2.1 | 轻量文本片段管理器 — protector/scheduler/storage 四件套 | 3,200+ 行 |

两者均包含：L2 流程文档、L3 宪法、context-manager 实现、turnType schema、tunable 参数、单元+集成测试、Capacitor 混合 App 产物。

### 目录结构

```
State-Control/
├── README.md
├── framework/                                      # 态控架构本体
│   ├── 态控架构-v4.7-全量版.md                     # L1 总纲
│   ├── 态控闭环系统设计流程指南_v7.3.md              # L2 流程指南
│   ├── 态控闭环系统人机设计流程_节点说明_v5.4.md       # L3 节点总说明
│   ├── 上下文管理器拼接机制_v1.1.md                  # context-manager 通用实现规范
│   ├── P0/N1~N15 节点说明 + 环节宪法 ×30+
│   └── ...
├── MetaAgent/                                      # 自举案例
│   └── ...
├── fugui-xiaoan/                                   # 产品一：富贵小安（记账助手）
│   ├── docs/                                       # L2 流程文档 v4.0
│   ├── l3-package/                                 # L3 宪法包（7 session + root）
│   ├── packages/fugui-xiaoan/src/                  # runtime 源码（state-machine/context-manager/dialogue-engine…）
│   ├── packages/fugui-xiaoan/test*.js              # 单元+集成测试
│   ├── products/build/                             # Capacitor 混合 App 产物
│   └── demos/demo/
├── zacuiben/                                       # 产品二：杂碎本（文本片段管理器）
│   ├── packages/zacuiben/src/                      # runtime 源码（dialogue-engine/scheduler/storage…）
│   ├── packages/zacuiben/test*.js                  # 单元+集成测试
│   ├── products/build/                             # Web 产物
│   └── demos/demo/
└── ...
```

### 专利声明

本研究受已提交的 AI Agent 调度方法专利申请保护。本仓库中的全部材料开放用于学术研究和参考。

### 引用

```
刘劲松. 态控架构：面向 LLM Agent 系统的确定性上下文管理方法论. 2026.
```

### 作者

听风者（Jinsong Liu）— 深圳 · 产品经理 / 全栈开发者 / 专利发明人

---

> 文档版本：v2.0
> 日期：2026-07-14
> 更新：新增富贵小安 v4.0 + 杂碎本 v2.1
