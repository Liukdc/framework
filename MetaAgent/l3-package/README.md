# 元智能体 L3 生成包

**N11 对齐报告**：verdict=aligned，25/25项检查通过，P0阻断项=0。

| # | 文件 | 说明 |
|---|------|------|
| 1 | `boundary-list.json` | N1 边界清单——15个intent（全部field_based）+ 元指令词表 + tunable声明 |
| 2 | `state-graph.json` | N3+N4 状态转移图——24状态 + 29条转移边 + 前置依赖矩阵 |
| 3 | `data-protocol.json` | N6 数据传递协议——15条协议 + 9项守卫 + turnHistory约束 + contractStoreConfig（SQLite+WAL+3表DDL） |
| 4 | `turnType-schema.json` | 统一turnType——六值 + changeLevel/changeLevelReason兜底 |
| 5 | `tunables.json` | N10 参数清单——10通用 + 4规则提炼 + 9不适用 + 冷启动配置 |
| 6 | `interfaces.json` | context-manager三接口——buildPromptContext 5参数 + updateGraph 8参数 |
| 7 | `constitutions/root-constitution.json` | N7 根宪法八条 |
| 8 | `constitutions/common-rules.json` | N8 公共规则三条 |
| 9 | `constitutions/session/p0.json` | P0 认知加载 |
| 10 | `constitutions/session/n1.json` | N1 场景定义 |
| 11 | `constitutions/session/n3.json` | N3 状态枚举 |
| 12 | `constitutions/session/n4.json` | N4 状态转移图 |
| 13 | `constitutions/session/n5.json` | N5 调度器核心 |
| 14 | `constitutions/session/n6.json` | N6 数据协议 |
| 15 | `constitutions/session/n7.json` | N7 根宪法 |
| 16 | `constitutions/session/n8.json` | N8 公共规则 |
| 17 | `constitutions/session/n9.json` | N9 各环节宪法 |
| 18 | `constitutions/session/n10.json` | N10 tunable |
| 19 | `constitutions/session/n11.json` | N11 契约对齐 |
| 20 | `constitutions/session/n12.json` | N12 L2→L3拆包 |
| 21 | `constitutions/session/n13.json` | N13 骨架生成 |
| 22 | `constitutions/session/n14.json` | N14 审骨架 |
| 23 | `constitutions/session/n15.json` | N15 调参交付 |
| 24 | `constitutions/analyzing-session.json` | ANALYZING 意图识别 |
| 25 | `README.md` | 本文件 |

---

## taskType：全部 field_based

L2 环节宪法和 L3 调度器声明一致——全部 field_based。判定依据：MetaAgent 每个环节均有明确的必采字段集、结构化 JSON Schema 校验、`@section validation` 定义的 DET 复验规则。调度器使用 stepName 精确匹配路由，0 次语义检索。

topicEvolution 不启用，但 **contractEvolution 已落地**——field_based 的跨会话记忆等价物：

| 能力 | 实现方式 |
|------|---------|
| 跨会话记忆 | contractStore.domainRules 按 stepName 注入已生效设计规则 |
| 分层留存 | major 永久 / minor 压缩 / invalid 归档 |
| 异步规则提炼 | ruleMiningQueue 积压触发 N10 定时提炼 |
| 三层注入 | 第0层领域规则 + 第1层候选预览 + 第2层变更历史包 |

详见 `data-protocol.json` 中的 `contractEvolutionConfig` 和 `sessionCheckpointConfig`。

---

**N2 跳过**：全部 field_based，N2双角色边界紧张度测试不适用。

**包统计**：25文件 | 全部 field_based | contractEvolution 已落地 | 无松弛节点
