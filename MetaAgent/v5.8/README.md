# MetaAgent v5.8

引导完成 P0→N15 态控设计流程的 AI Agent——输入设计想法，输出骨架代码。

## 快速开始

```bash
# 1. 设 API Key
export DEEPSEEK_API_KEY=sk-xxx

# 2. 安装依赖（首次）
npm install

# 3. 单轮模式
node src-v5.8/index.js "帮我设计一个记账智能体"

# 4. 交互模式（无参启动）
node src-v5.8/index.js
# 输入 /exit 退出  /state 看状态  /metrics 看指标

# 5. 完整 P0→N15 演示
node src-v5.8/demo-fugui-xiaoan.js
```

## 目录

```
├── src-v5.8/        ← 调度器/状态机/适配器/工具注册/宪法加载 (13 JS)
├── n14-toolchain/   ← 审骨架工具链 (静态检查/行为测试/机制检查)
├── l3-v5.8/         ← L3 结构化配置 (boundary/states/routeTable 等 9 JSON)
├── constitutions/   ← 18 份环节宪法 .md
├── L2-*.md          ← P0→N15 流程文档
└── package.json
```

## 要求

Node.js >= 18 | DeepSeek API Key | `npm install`（仅需 better-sqlite3）
