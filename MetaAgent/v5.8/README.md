# MetaAgent v5.8

引导完成态控设计流程的 AI Agent——输入设计想法，经过 INIT（项目选择）→ P0（认知加载）→ N1~N15 逐房间设计 → N16 打包交付，输出可安装的智能体。

## 快速开始

```bash
# 设 API Key
$env:DEEPSEEK_API_KEY="sk-xxx"

# Web 界面
node src/server.js
# 浏览器打开 http://localhost:3000

# 终端模式
node src/index.js "帮我设计一个记账智能体"
node src/index.js   # 交互式
```

## 目录

```
MetaAgent/
├── README.md
├── FLOW.md                       ← 完整流程表（11 章节）
├── chat.html                     ← Web 聊天界面
├── package.json
│
├── src/                          ← 状态机引擎（14 JS）
│   ├── index.js                  入口 + createAgent() 工厂
│   ├── scheduler.js              主循环（29KB）
│   ├── state-machine.js          状态定义 + 转移
│   ├── route-table.js            路由匹配
│   ├── context-manager.js        宪法注入 + 对话拼接
│   ├── deepseek-adapter.js       LLM 适配
│   ├── contract-store.js         21 张表 + 读写（22KB）
│   ├── outputs-manager.js        产出物管理
│   ├── telemetry.js              指标统计
│   ├── tool-registry.js          工具注册
│   ├── tunables.js               可调参数
│   ├── l2-l3-validator.js        L2-L3 校验
│   └── server.js                 Web 服务
│
├── constitutions/                ← 20 份环节宪法 .md
├── l3/                           ← L3 JSON 配置 + schema.sql
├── tools/                        ← 构建工具
│   ├── generate-l3.js            N12 自动拆包
│   ├── n16-package.js            打包交付
│   └── viz-fsm.js                状态机可视化
└── tests/                        ← 65+ 单元测试
```

## 状态机架构

```
INIT(项目选择) → P0(认知加载) → N1~N15(逐节点设计) → N16(打包交付)

每轮对话：
M1 元指令 → ANALYZING(意图识别) → IN_SESSION(房间执行) → DET 校验 → 落盘

5 个 M1 口令：元智能体 / 退出 / 取消 / 切断房间 / 房间落地
```

## 也可 npm 安装

```bash
npm install metaagent-v5
import { createAgent } from 'metaagent-v5';
const agent = await createAgent({ apiKey: 'sk-xxx' });
```

## 要求

Node.js >= 18 | DeepSeek API Key | 零其他依赖
