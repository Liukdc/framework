# 上下文管理器（context-manager）拼接机制 · 通用实现规范

**版本**：v1.1
**日期**：2026-07-14
**基于**：态控架构 v4.7 §2.4 / §3.9 步骤三 / §3.10 @importance
**适用场景**：field_based 和 topic_based 通用

---

## 一、定位

上下文管理器（context-manager）是态控架构中的独立状态机，不是环节宪法的一部分。

**它只管一件事**：从态控调度器交给它的内容中，按拼接规则组装出本轮 LLM 模型实例计算所需的上下文窗口。

态控调度器负责路由和全量记录。上下文管理器负责拼接。环节宪法负责模型行为规则。三者各司其职。

---

## 二、输入

态控调度器在每轮调用模型实例前，将以下内容交给上下文管理器：

| 输入 | 来源 | 说明 |
|------|------|------|
| taskType | activeSession.taskType | field_based 或 topic_based |
| roomConversationLog[] | contractStore 按 userId+roomId 查询 | 当前房间的全量历史对话原文 |
| contractOut | sessionCheckpoint 或 topicEvolution | 已确认的结构化字段/状态快照 |
| domainRules[] | contractStore 按 stepName 或 topicPath 匹配 | 已生效领域规则（经 importance 排序） |
| relatedTopics[] | topicIndex（仅 topic_based） | 关联主题摘要卡片 |
| topicEvolution 分层包 | topicEvolution 表（仅 topic_based） | major 事件 + minor 压缩摘要 + stateSnapshot |
| currentAskField | 上一轮 turnType 返回的 askingField | 本轮硬门控保护锚点 |
| currentStepName | activeSession.stepName | field_based 当前环节名，用于领域规则精确匹配 |
| tunableParams | tunables.json | turnHistory_limit / critical_room_history_boost / offTask_threshold / 各阈值 |
| offTaskSuspicion | 态控调度器 DET 关键词扫描 | 偏离嫌疑标记 |

---

## 三、输出

```
buildPromptContext() 返回：
{
  context: string,           // 拼接好的上下文文本（直接喂给 LLM）
  tokenEstimate: number,     // 估算 token 消耗
  debug: {
    protectedCount: number,  // 被硬门控保护的轮次数
    scoredCount: number,     // 进入评分通道的轮次数
    truncatedCount: number,  // 被最低匹配度截断的轮次数
    importanceBreakdown: {}  // 各 importance 等级的保留轮次明细
  }
}
```

---

## 四、拼接流程（四步）

### 第 0 步：@importance 截断基数计算

根据当前房间的 @importance 等级，计算 roomConversationLog 保留轮次上限：

| importance | 比例系数 | 实际轮次（base=20） |
|:--:|------|------|
| critical | × critical_room_history_boost（默认 2.0） | 40 |
| high | × 0.6 | 12 |
| normal | × 0.4 | 8 |
| low | × 0.15 | 3 |

取 roomConversationLog 的最近 N 轮（N = 上述计算值），作为候选集。

**纪律**：这个截断在硬门控保护和综合评分之前执行。超出上限的最久远轮次直接丢弃，不进入任何通道。

### 第 1 步：硬门控保护（DET，0 次 LLM 调用）

对候选集中的每一轮，执行以下检查。命中任意一项 → 标记为保护态 → 从评分通道候选集移除 → 放入保护态队列。

#### 1.1 field_based 模式：字段级硬门控

```
规则：若 currentAskField ≠ null，
     遍历候选轮次，若某轮的 askingField === currentAskField，
     则该轮被保护。

保护上限：不超过 turnHistory_limit 的 50%。
```

#### 1.2 topic_based 模式：主题级硬门控（两阶段检索）

```
阶段一：DET 关键词粗筛
阶段二：embedding 精筛
保护上限：同 field_based，不超过 turnHistory_limit 的 50%。
```

#### 1.3 通用增强：逻辑依赖保护（可选，场内有向关联图时启用）

此层独立于字段/主题级门控——即使 currentAskField = null，逻辑依赖保护仍生效。

**纪律**：被保护的内容以完整原文形态注入，不经过评分通道的形态降级处理。

### 第 2 步：综合匹配度评分（对未被保护的剩余候选）

```
综合匹配度得分 = 语义匹配度 × 位置衰减系数
```

#### 2.1 语义匹配度（_scoreMatch）

- field_based：中文 bigram 分词后 Jaccard 相似度
- topic_based：embedding 余弦相似度 ×0.7 + bigram Jaccard ×0.3

#### 2.2 位置衰减系数

```
positionDecay = 1.0 - (轮次距离 / turnHistory_limit)
```

#### 2.3 形态分配

| 得分区间 | 形态 | token 占比 |
|---------|------|-----------|
| ≥ 0.7 | 完整原文 | 100% |
| 0.4 ~ 0.7 | 摘要 | ~30% |
| 0.2 ~ 0.4 | 锚点 | ~10% |
| < 0.2 | 移除 | 0% |

### 第 3 步：两通道联合编排

```
最终上下文窗口拼接顺序：

[系统提示层]
  ├─ 环节宪法
  ├─ 已采集字段 collectedFields（仅 field_based）
  └─ 领域规则 domainRules

[保护态队列]（按时间倒序）
  └─ 硬门控+逻辑依赖保护的轮次（完整原文）

[评分通道队列]（按综合匹配度得分降序）
  ├─ 得分 ≥ 0.7：完整原文
  ├─ 得分 0.4~0.7：摘要
  ├─ 得分 0.2~0.4：锚点
  └─ 得分 < 0.2：移除

[偏离标记]
  └─ 态控调度器提示

[当前用户输入]
```

### 第 4 步：最低匹配度截断 + token 预算校验

截断规则：评分通道中第一个得分 < minimumMatchThreshold 的候选及其后续全部截断。保护态豁免。

token 预算：拼接后估算总量，超过 70% 则从评分通道末尾逐条降级，保护态豁免。

---

## 五、特别的：currentAskField 为 null 时的降级

turnType="reply"/"complete"时，字段/主题级硬门控不执行，降级为纯语义匹配度评分。逻辑依赖保护仍生效。不报错不阻断。

---

## 六、拼接后的结构化标记规范

```
[摘要-第N轮] 首句摘要... 结尾句摘要 [/摘要]
[锚点-第N轮] 关键实体词1, 关键实体词2 [/锚点]
```

模型被告知：带标记的内容是"供给性上下文"而非"待回复的对话内容"。

---

## 七、tunable 消费方

| 参数 | 默认值 | 消费位置 |
|------|--------|----------|
| turnHistory_limit | 20 | §四第0步：截断基数 |
| critical_room_history_boost | 2.0 | §四第0步：critical 乘数 |
| topic_anchor_similarity_threshold | 0.6 | topic_based 精筛 |
| topic_keyword_overlap_threshold | 0.2 | topic_based 粗筛 |
| strengthens_weight_cap | 3 | 领域规则注入排序 |
| offTask_threshold | 0.7 | 偏离标记注入判定 |

---

## 八、taskType 差异总览

| 维度 | field_based | topic_based |
|------|----------------------|----------------------|
| 硬门控锚点 | 字段名 DET 精确匹配 | 主题标签 embedding 两阶段 |
| 语义匹配度 | bigram Jaccard | cosine ×0.7 + bigram ×0.3 |
| 结构化字段注入 | collectedFields（JSON） | topicSnapshot + evolution 包 |
| 领域规则注入 | stepName 精确匹配 | topicPath 前缀匹配 + 子图扩散 |
| 最低匹配度阈值 | 0.2 | 0.3 |
| askingField=null 降级 | 字段门控停用，纯语义 | 主题门控停用，纯语义 |

---

> **版本**：v1.1
> **日期**：2026-07-14
> **变更**：v1.0→v1.1：输入表新增 currentStepName / tunable 消费方补 offTask_threshold / importance 截断比例调整
> **适用**：所有 field_based 和 topic_based 的态控架构智能体
