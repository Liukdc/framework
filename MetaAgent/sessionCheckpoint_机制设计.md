# sessionCheckpoint 机制设计

**适用**：field_based 模式。topic_based 已有 topicEvolution 承担跨会话记忆。

---

## 一、存储

### 1.1 新增 contractStore 表

```sql
CREATE TABLE IF NOT EXISTS sessionCheckpoints (
    userId TEXT PRIMARY KEY,
    lastCompletedStep TEXT NOT NULL,
    completedSteps TEXT NOT NULL,  -- JSON array: ["p0","n1","n3",...]
    stepSnapshots TEXT NOT NULL,   -- JSON: { "n1": { "collectedFields": {...}, "timestamp": "..." } }
    resumedAt TEXT,
    expiredAt TEXT,
    ttl INTEGER DEFAULT 604800    -- 7天，可tunable
);
```

### 1.2 三层留存

| 层级 | 内容 | 作用 |
|------|------|------|
| 第0层 | `completedSteps` 数组 | 恢复时识别进度断点 |
| 第1层 | `stepSnapshots` 各步骤快照 | 恢复时注入已采集字段 |
| 第2层 | `lastCompletedStep` | 快速定位下一步 |

## 二、调度器接入（N5 ANALYZING 阶段）

```
1. 用户唤醒"小智"
2. ANALYZING 开始
3. DET 查 sessionCheckpoints WHERE userId=current
   ├─ 无记录 → 正常进 P0
   ├─ 有记录但已过期(ttl) → 清空, 正常进 P0
   └─ 有记录且未过期 →
        model 生成 resume_chat 询问:
        "你上次做到了[lastCompletedStep]，要继续吗？"
        ↓
        用户确认 → intent=resume_chat
                  注入 completedSteps + stepSnapshots 到 ANCILLYING contractOut
                  N4 根据 prerequisiteDependencies 找第一个未完成步骤
                  路由到该步骤的 IN_SESSION
        用户拒绝 → 清空 checkpoint，正常进 P0
```

4. 每个 IN_SESSION complete → DET 更新 checkpoint:
   - completedSteps 追加上一步
   - stepSnapshots 存储当步 collectedFields
   - lastCompletedStep 更新

## 三、房间对话日志——切换不丢失，可搜索

sessionCheckpoint 管"流程进度"，但"每个房间聊了什么"由一个独立模块负责——**roomConversationLog**。

切换房间时不放弃任何东西——当前房间的全部对话已实时落盘到 roomConversationLog。离开 N10 去 N1，N10 的聊天记录完好保留在日志里。返回 N10 时，从这个房间的日志中加载最近的对话上下文。

### 3.1 存储结构

```sql
CREATE TABLE IF NOT EXISTS roomConversationLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    roomId TEXT NOT NULL,           -- stepName: "n1"/"n5"/"n10"
    sessionId TEXT NOT NULL,        -- 会话标识，同一次唤醒为同一 sessionId
    turnIndex INTEGER NOT NULL,     -- 本轮在本次会话中的序号
    userInput TEXT NOT NULL,
    modelResponse TEXT NOT NULL,
    turnType TEXT NOT NULL,
    askingField TEXT,
    changeLevel TEXT,
    timestamp TEXT NOT NULL,
    indexedForSearch BOOLEAN DEFAULT 0  -- 是否已建立搜索索引
);

CREATE INDEX idx_room_user_roomId ON roomConversationLog(userId, roomId);
CREATE INDEX idx_room_session ON roomConversationLog(userId, sessionId);
CREATE INDEX idx_room_timestamp ON roomConversationLog(userId, roomId, timestamp);
```

### 3.2 写入时机

每个 IN_SESSION 内的 turn（ask/reply/complete/off-task/giveup）→ 实时追加一行到 roomConversationLog。不需要等 complete——用户说一半切走了，那半句对话也已经落盘。

### 3.3 返回房间时的内容注入

态控调度器不决定注入什么——它只负责**全量记录**和**路由到正确房间**。注入逻辑由每个环节自己的**上下文管理器**决定。

```
IN_SESSION(n1) 开始
  ↓
态控调度器: 路由到 n1，提供三个数据源:
  ├─ roomConversationLog(roomId='n1')  ← 原始对话流（全量）
  ├─ sessionCheckpoints.stepSnapshots["n1"]  ← 结构化快照
  └─ contractStore.domainRules(stepName='n1')  ← 已生效规则
  ↓
n1上下文管理器: 从三个数据源中拼接 prompt
  ├─ 取 roomConversationLog 最近 N 轮
  ├─ 取 stepSnapshots 中的 collectedFields
  └─ 注入 applicable 的 domainRules
  ↓
拼接完成 → 递给模型
```

### 3.4 搜索功能

用户说"我们之前讨论调度器第五层的时候怎么决定的？"→ scheduling 模块或 DET 关键词匹配 → 查 roomConversationLog 全文搜索 → 返回匹配的对话片段。

模型也可以在 IN_SESSION 中主动搜索：@section ask-rules 中定义"当用户引用历史讨论时，搜索本房间日志"。

| 搜索方 | 触发方式 | 搜索范围 |
|--------|---------|---------|
| 用户显式搜索 | "搜索调度器第五层" | 所有房间 |
| 模型主动搜索 | 用户说"上次讨论的那个..." | 当前房间 |
| DET 自动注入 | 返回房间时自动加载最近 20 轮 | 当前房间 |

### 3.5 与 sessionCheckpoint 的区别

| | sessionCheckpoint | roomConversationLog |
|---|---|---|
| 记录什么 | 结构化快照：采集了哪些字段、流程进度 | 原始对话流：每轮 userInput + modelResponse |
| 用途 | "做到哪儿了"——恢复进度 | "聊了什么"——可搜索 |
| 粒度 | 房间级（每房间一个 stepSnapshot） | turn 级（每次对话一行） |
| 写入时机 | 房间 complete 时 | 实时，每个 turn 落盘 |
| 态控调度器职责 | 全量记录，不做注入决策 | 全量记录，不做注入决策 |
| 注入决策 | 由目标环节的上下文管理器自决 | 由目标环节的上下文管理器自决 |

态控调度器只管两件事：**全量记录** + **正确路由**。每个环节是自治的——它的上下文管理器从原始日志中按自己的拼接规则组装 prompt。

## 四、Tunable 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| session_checkpoint_ttl | 604800 (7天) | 检查点过期时间 |
| session_checkpoint_max_steps | 16 | 最大录制步骤数 |
| room_log_retention_days | 90 | 房间对话日志保留天数 |

## 五、与 contractEvolution 的关系

| | contractEvolution | sessionCheckpoint |
|---|---|---|
| 记录什么 | 规则变更历史 | 流程进度 + 各环节结构化快照 |
| 保留策略 | major永久/minor压缩/invalid归档 | ttl过期自动清除 |
| 注入场景 | 同一 stepName 再次执行时 | 跨会话恢复 + 环节间切换时 |
| 消费方 | 上下文管理器（三层注入） | 态控调度器（ANALYZING 路由） |

两者互补：contractEvolution 管"同一环节的规则怎么变"，sessionCheckpoint 管"16步流程走到哪儿了 + 每个环节收敛时采集了什么"。
