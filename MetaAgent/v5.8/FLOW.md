# MetaAgent v5.8 流程表

## 一、启动

```
┌─────────────────────────────────────────────────────────┐
│  node server.js                                         │
│       │                                                  │
│       ├─ 检测 DEEPSEEK_API_KEY 环境变量                  │
│       │   ├─ 有 → 跳过                                   │
│       │   └─ 无 → 浏览器页面显示 API key 输入框          │
│       │        → 用户输入 → /set-key → 保存到内存        │
│       │                                                  │
│       ├─ 自动找端口 (3000→3001→...→3020)                 │
│       └─ 浏览器打开 http://localhost:{PORT}              │
└─────────────────────────────────────────────────────────┘
```

## 二、会话初始化 (initSession)

```
┌─────────────────────────────────────────────────────────┐
│  GET /status → 有 key → POST /start → initSession()     │
│       │                                                  │
│       ├─ L2-L3 一致性校验                                │
│       ├─ 查 sessions 表: getLastActiveSession()          │
│       │   ├─ 有历史 (state ≠ IDLE)                       │
│       │   │   → ANALYZING 状态                           │
│       │   │   → 加载上次 intent + taskType               │
│       │   │   → "续接上次设计 (N3)。输入你的想法。"       │
│       │   │                                              │
│       │   └─ 无历史                                       │
│       │       → IDLE 状态                                │
│       │       → "元智能体已就绪。说出你的设计想法。"       │
│       │                                                  │
│       └─ createSession → INSERT INTO sessions            │
└─────────────────────────────────────────────────────────┘
```

## 三、每轮对话 (handleTurn)

```
┌─────────────────────────────────────────────────────────┐
│  用户输入                                                │
│       │                                                  │
│       ├─ Layer 0: M1 元指令 EXACT_MATCH                  │
│       │   wake("元智能体") / exit("退出")                │
│       │   cancel("取消") / switch("切断房间")             │
│       │   → 匹配到 → 执行 M1 处理 → 返回                 │
│       │                                                  │
│       ├─ Layer 1: ANALYZING                              │
│       │   调用模型 API，强制选择 (A/B/C/D...)             │
│       │   + logprobs 获取真实概率                        │
│       │       │                                          │
│       │       ├─ probability ≥ 0.6                       │
│       │       │   → 路由到对应 IN_SESSION 房间           │
│       │       │   → 加载环节宪法                         │
│       │       │   → updateSessionState                   │
│       │       │                                          │
│       │       └─ probability < 0.6 (低置信度)             │
│       │           → 查进度: _getProgress()               │
│       │           → 无进度: "你想设计什么样的智能体？"     │
│       │           → 有进度: "已完成 P0→N1，下一步 N2"    │
│       │           → 全完成: "修改某个还是新设计？"        │
│       │           → turnType=ask，等用户回答             │
│       │                                                  │
│       ├─ Layer 2: IN_SESSION 模型自治 (max 3 轮 tool)    │
│       │   注入宪法 + 对话历史 + 工具                     │
│       │   模型调用工具( writeOutput / writeFile / ... )   │
│       │   → 无工具调用 → break                           │
│       │                                                  │
│       ├─ Layer 3: DET 四项校验                            │
│       │   → 不通过 → CLARIFYING                          │
│       │   → 通过 → 继续                                  │
│       │                                                  │
│       ├─ v5.8 强制落盘                                   │
│       │   模型没调 writeOutput → 调度器兜底写入          │
│       │                                                  │
│       └─ 更新 session 状态 → 返回结果                    │
└─────────────────────────────────────────────────────────┘
```

## 四、节点体系 (16 个设计节点)

```
P0    认知加载    — 对齐态控概念，确认设计目标
N1    场景定义    — 边界清单，意图枚举
N2    边界测试    — 紧张度测试 + 语料采集
N3    状态枚举    — 状态机节点定义，执行体分派
N4    转移图      — transitions.json
N5    调度器      — DET 复验规则，turnType schema
N6    路由表      — routeTable.json
N7    根宪法      — 根宪法 + 架构机制
N8    局部宪法    — 环节宪法编写
N9    验证规则    — @section validation 结构化规则
N10   tunable     — 可调参数声明
N11   契约对齐    — 跨节点一致性验证
N12   L2→L3 拆包 — 生产 L3 JSON 配置包
N13   骨架生成    — skeleton 代码
N14   审骨架      — 20+1 case + 9+2 机制
N15   调参交付    — tunable 锁定 + 最终验证
N16   打包交付    — npm 包 + fsm.md 可视化
```

## 五、交付物流水线

```
MetaAgent 设计对话 (P0→N15)
    ↓
N12 → L3 JSON (boundary/states/transitions/routeTable/...)
    ↓
N16 → node n16-package.js --l3 ./l3-v5.8
    ↓
    ├── index.js           SDK 入口
    ├── package.json       npm 包
    ├── l3-v5.8/           锁定版状态机配置
    ├── fsm.md             状态机流程图 (Mermaid)
    ├── README.md          使用说明
    └── *.tgz              可分发安装包
```

## 六、独立工具

| 工具 | 用法 | 说明 |
|------|------|------|
| viz-fsm | `node viz-fsm.js --l3 ./l3-v5.8` | 状态机流程图+路由表+覆盖检查 |
| n16-package | `node n16-package.js --l3 ./l3 --name a --out ./p` | 打包为 npm 可安装包 |
| generate-l3 | `node generate-l3.js --out ./my-agent` | MetaAgent N12 自动拆包 |

## 七、数据库表 (首次初始化生成)

```sql
-- 会话状态（断点续接核心）
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  state           TEXT NOT NULL DEFAULT 'IDLE',  -- IDLE/LISTENING/ANALYZING/IN_SESSION/...
  current_intent  TEXT,                           -- P0/N1/N2/...
  task_type       TEXT,                           -- field_based/topic_based
  created_at      INTEGER,
  updated_at      INTEGER,
  tunable_snapshot TEXT
);

-- 主题演化（topic_based 专属，记录话题漂移）
CREATE TABLE topic_evolution (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  topic_id    TEXT NOT NULL,
  intent      TEXT NOT NULL,
  change_level TEXT NOT NULL,     -- major/minor/patch/active/abandoned/checkpoint
  state_snapshot TEXT,
  created_at  INTEGER
);

-- 产出物（关键交付物落盘 + 进度追踪）
CREATE TABLE outputs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  intent      TEXT NOT NULL,       -- 哪个节点产出的
  output_name TEXT,                -- L2-P0-v5.8 等
  importance  TEXT NOT NULL,       -- critical/high/normal
  content     TEXT,                -- 产出内容
  written_at  INTEGER
);

-- 对话日志（可审计的完整对话记录）
CREATE TABLE conversation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  turn_index  INTEGER,
  role        TEXT,                -- user/assistant/system
  content     TEXT,
  turn_type   TEXT,                -- ask/reply/complete/off-task/...
  created_at  INTEGER
);

-- 全文搜索（可选，FTS5 加速对话检索）
CREATE VIRTUAL TABLE conversation_fts USING fts5(
  session_id, role, content, tokenize='unicode61'
);
```

| 表 | 用途 |
|----|------|
| sessions | 断点续接——记住上次在哪个房间 |
| outputs | 进度追踪——哪些节点完成了 |
| topic_evolution | 话题漂移记录 |
| conversation_log | 完整对话审计 |
| conversation_fts | 对话全文搜索（可选） |

## 八、状态转换简图

```
IDLE → LISTENING → ANALYZING
                        ├─ probability ≥ 0.6 → IN_SESSION(intent)
                        │                       ├─ complete → LISTENING
                        │                       ├─ off-task → ANALYZING
                        │                       └─ giveup → LISTENING
                        │
                        └─ probability < 0.6 → ask(进度建议) → 等待下一轮
```
