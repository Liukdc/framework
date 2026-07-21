# MetaAgent v5.8 流程表

## 一、启动

```
node server.js

1. 检测 DEEPSEEK_API_KEY
   ├─ 有 → 跳过
   └─ 无 → 页面显示输入框 → /set-key → 保存到内存

2. 自动找端口 (3000→3020)

3. contractStore.open()
   ├─ 查 sessions 表是否存在
   │   ├─ 不存在 → 首次启动 → _createTables() 建21张表
   │   └─ 已存在 → 后续启动 → 跳过建表
   ├─ _verifyAllTables() 逐表验证
   │   ├─ ✅ 全部就绪
   │   └─ ❌ 缺少 N 张表（全部缺失=致命）
   └─ 首次 → _initProject() 创建默认项目

4. 浏览器打开 http://localhost:{PORT}
   页面 /status → 有key → POST /start
```

## 二、项目选择 (轻量 ANALYZING + 二次确认)

```
POST /start → initSession()

查 projectRegistry
├─ 无项目
│   → 直接进入创建流程："给项目起个名字"
│
└─ 有项目
    → "已有项目：
        1. 记账助手 ←上次
        2. 提醒助手
       输入编号或项目名选择："

用户输入 → /select-project → 轻量ANALYZING
├─ 模型返回 A/B/C → 选择已有项目 → finishInit()
├─ 模型返回创建 → phase: confirm_create
│   → "确认创建新项目「xxx」？输入名字确认，或'取消'"
│
└─ 模型失败 → DET兜底(数字+模糊匹配)

创建确认 → /confirm-create
├─ 输入名字 → 创建项目 → finishInit()
└─ 输入"取消" → 回到项目列表

项目选定 → finishInitSession()
├─ L2-L3 校验
├─ 断点续接（有历史→续接，无→IDLE）
└─ createSession

API端点：
  /start           → 项目列表
  /select-project   → 轻量ANALYZING选择
  /confirm-create   → 二次确认创建
```

## 三、每轮对话 (handleTurn)

```
用户输入
├─ Layer 0: M1 元指令 EXACT_MATCH
│   wake/exit/cancel/switch → 匹配到则执行 → 返回
│
├─ Layer 1: ANALYZING
│   强制选择+logprobs
│   ├─ probability ≥ 0.6
│   │   → 路由到 IN_SESSION 房间 → 加载宪法
│   │
│   └─ probability < 0.6
│       → 查进度 (_getProgress)
│       → 无进度: "想设计什么样的智能体？"
│       → 有进度: "已完成 P0→N1，下一步 N2"
│       → 全完成: "修改某个还是新设计？"
│
├─ Layer 2: IN_SESSION (max 3轮tool)
│   注入宪法+历史+工具 → 模型调用工具
│   → 无工具调用则break
│
├─ Layer 3: DET 四项校验
│   → 不通过 → CLARIFYING
│
├─ 强制落盘: 模型未调writeOutput → 调度器兜底
│
└─ 更新session → 返回结果
```

## 四、API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | chat.html |
| `/status` | GET | 检测 API key 状态 |
| `/set-key` | POST | 输入 API key |
| `/start` | POST | initSession（返回项目列表） |
| `/select-project` | POST | 轻量ANALYZING：选择/创建项目 |
| `/confirm-create` | POST | 二次确认创建新项目 |
| `/chat` | POST | 一轮对话 |

## 五、节点体系 (16 个设计节点)

```
P0    认知加载    — 对齐态控概念，确认设计目标
N1    场景定义    — 边界清单，意图枚举
N2    边界测试    — 紧张度测试 + 语料采集
N3    状态枚举    — 节点定义，执行体分派
N4    转移图      — transitions.json
N5    调度器      — DET 复验规则，turnType
N6    路由表      — routeTable.json
N7    根宪法      — 根宪法 + 架构机制
N8    局部宪法    — 环节宪法编写
N9    验证规则    — @section validation
N10   tunable     — 可调参数声明
N11   契约对齐    — 跨节点一致性验证
N12   L2→L3 拆包 — 生产 L3 JSON 配置
N13   骨架生成    — skeleton 代码
N14   审骨架      — 20+1 case + 9+2 机制
N15   调参交付    — tunable 锁定 + 最终验证
N16   打包交付    — npm 包 + fsm.md 可视化
```

## 六、交付物流水线

```
MetaAgent 设计对话 (P0→N15)
    ↓
N12 → L3 JSON
    ↓
N16 → n16-package.js
    ↓
    ├── index.js           SDK 入口
    ├── package.json       npm 包
    ├── l3-v5.8/           锁定版状态机
    ├── fsm.md             流程图 (Mermaid)
    ├── README.md
    └── *.tgz              安装包
```

## 七、独立工具

| 工具 | 用法 | 说明 |
|------|------|------|
| viz-fsm | `node viz-fsm.js --l3 ./l3-v5.8` | 状态机流程图+路由表+覆盖检查 |
| n16-package | `node n16-package.js --l3 ./l3 --name a --out ./p` | 打包为 npm 包 |
| generate-l3 | `node generate-l3.js --out ./my-agent` | N12 自动拆包 |

## 八、数据库表 (21张，对齐态控附录v5.8)

| 分组 | 表 | 作用 |
|------|---|------|
| P0 契约 | analyzing_contract_in/out | ANALYZING输入输出契约，支持意图纠错逃生舱 |
| P1 会话 | sessions | 断点续接——记住房间+状态 |
| P2 主题 | topicEvolution / Event / Archive | topic_based 主题演化 |
| P3 规则 | domainRules / ruleCandidates / ruleMiningQueue | 领域规则网络图+异步提炼 |
| P4 检查点 | sessionCheckpoints | field_based 进度检查点(7天TTL) |
| P5 对话 | roomConversationLog / conversationArchive / conversationArchive_fts | 房间对话+分段保留+全文搜索 |
| P6 房间 | roomStateIndex | 全窗口房间状态——物化视图 |
| P7 产出 | outputRegistry / outputs | 产出物索引+进度追踪 |
| P8 项目 | projectRegistry / userLastProject | 多项目隔离+默认项目 |
| P9 审计 | conversation_log | 全局对话审计 |

## 九、状态转换简图

```
IDLE → LISTENING → ANALYZING
                        ├─ prob ≥ 0.6 → IN_SESSION(intent)
                        │    ├─ complete → LISTENING
                        │    ├─ off-task → ANALYZING
                        │    └─ giveup → LISTENING
                        │
                        └─ prob < 0.6 → ask(进度) → 等待下一轮
```
