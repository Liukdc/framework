# MetaAgent v5.8

引导完成 P0→N15 态控设计流程的 AI Agent——输入设计想法，输出可加载的 L3 配置包。

## 快速开始

```bash
# npm 安装后直接用
npm install metaagent-v5
```

```js
import { createAgent } from 'metaagent-v5';

// 无 API key → 自动降级 mock 模式（CI/离线可用）
const agent = await createAgent();

// 有 API key → 真模型
const agent = await createAgent({ apiKey: 'sk-xxx' });

await agent.startSession('demo');
const r = await agent.sendMessage('帮我设计一个记账智能体');
console.log(r.content);
await agent.destroy();
```

```bash
# 本地开发（无需 npm install）
export DEEPSEEK_API_KEY=sk-xxx
node src-v5.8/index.js "帮我设计一个记账智能体"  # 单轮
node src-v5.8/index.js                          # 交互模式
node src-v5.8/demo-fugui-xiaoan.js               # 完整 P0→N15
```

## 目录

```
├── src-v5.8/        ← 调度器/状态机/适配器/工具注册/宪法加载 (14 JS)
├── n14-toolchain/   ← 审骨架工具链 (静态检查/行为测试/机制检查)
├── l3-v5.8/         ← L3 结构化配置 (boundary/states/routeTable 等 9 JSON)
├── constitutions/   ← 18 份环节宪法 .md
└── package.json
```

## 要求

Node.js >= 18 | 零依赖即可运行 | 设 `DEEPSEEK_API_KEY` 用真模型，不设自动 mock
