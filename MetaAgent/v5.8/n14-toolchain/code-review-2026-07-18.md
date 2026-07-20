# MetaAgent v5.8 全面代码审核报告

**审核时间**：2026-07-18 08:50 GMT+8
**审核范围**：`src-v5.8/` 13 个 JS 文件 + `n14-toolchain/` 4 个 JS 文件（共 17 个）
**审核方法**：逐文件人工深读 + 跨文件交叉验证（scheduler ↔ state-machine ↔ route-table ↔ L2/L3 文档）

---

## 核心结论

**发现 28 个问题，其中 P0 阻塞级 4 个、P1 重要级 14 个、P2 建议级 10 个。**

最严重的 4 个 P0 问题都集中在**真实的运行时正确性**：scheduler 隐式全局变量、N2 工具调用了无效上下文、API key 时机错误、宪法加载违反环节隔离。前两个会让代码在严格模式或生产环境下立刻崩溃；后两个虽不致命但**直接违反态控架构 v5.8 的设计原则**。

---

## 一、P0 阻塞级（必须立即修复）

### P0-1：scheduler.js 中 `inSessionResult` 未声明（隐式全局变量）

**位置**：`scheduler.js` L107 / L110 / L114

```js
if (intent === 'N2') {
  inSessionResult = await this._runN2DualRole(...);   // ← 未声明
} else if (intent === 'N13') {
  inSessionResult = await this._adapter.callCodeModel(...); // ← 未声明
} else {
  inSessionResult = await this._adapter.callInSession(...); // ← 未声明
}
```

**问题**：`inSessionResult` 三处赋值均未用 `let/const` 声明。ESM 模块**默认严格模式**，这一行会直接抛 `ReferenceError: inSessionResult is not defined`。

**为何 N14 没发现**：simulate.js 用的是 Mock 适配器，且没真正运行 handleTurn，只测试了状态机和路由。这是 N14 工具链的覆盖盲区。

**修复**：在 L106 之前加 `let inSessionResult;`

---

### P0-2：tool-registry.js 中 N2 工具对临时 ctx 赋值，等于无效

**位置**：`tool-registry.js` L101（n2InjectRole1）+ L119（n2InjectRole2）

```js
handler: async (args, ctx) => {
  ctx._n2Role1Output = args.sceneDefinition;   // ctx 是 scheduler 创建的临时对象
  return { success: true, step: 'role1_done' };
}
```

**问题**：scheduler.js L258-264 每次 `_executeTool` 都新建一个 ctx 字面量对象：

```js
const ctx = {
  sessionId: this._sessionId,
  contractStore: this._store,
  _n2Role1Output: this._n2Role1Output,  // 这里是值拷贝，不是引用
  ...
};
return this._tools.execute(name, args, ctx);
```

工具对 `ctx._n2Role1Output` 的赋值只改了临时对象，**scheduler 的 `this._n2Role1Output` 不会更新**。N2 双角色串行依赖这个状态，等于工具调用白做。

**修复**：把 ctx 改成持有 scheduler 引用的形式：
```js
const ctx = {
  sessionId: this._sessionId,
  contractStore: this._store,
  scheduler: this,  // 让工具通过 ctx.scheduler._n2Role1Output 写
};
// 工具侧：ctx.scheduler._n2Role1Output = args.sceneDefinition;
```
或者改用 setter 注入。

---

### P0-3：deepseek-adapter.js 中 API_KEY 模块加载时读取，运行时改不动

**位置**：`deepseek-adapter.js` L7

```js
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
```

**问题**：常量在模块加载时求值。index.js L51 在 `MetaAgent` 构造函数里 `process.env.DEEPSEEK_API_KEY = options.apiKey`，但此时 adapter 模块**早已被 import**，`DEEPSEEK_API_KEY` 已经定型。也就是说 **`new MetaAgent({ apiKey: '...' })` 传入的 key 根本不会被用到**。

**为何没爆**：simulate 用 Mock 适配器，不打真 API。一旦真实调用就 401。

**修复**：改成实例字段——
```js
export class DeepSeekAdapter {
  constructor(tunables, apiKey) {
    this._tunables = tunables;
    this._apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    if (!this._apiKey) console.warn('[adapter] DEEPSEEK_API_KEY 未设置');
  }
  // _call 中用 this._apiKey
}
```
index.js 在 new DeepSeekAdapter 时把 `options.apiKey` 传进去。

---

### P0-4：constitutions/loader.js 把 16 份宪法合并成 5 份，违反环节隔离

**位置**：`constitutions/loader.js` L50-52

```js
if (['N2', 'N3', 'N4', 'N5', 'N6'].includes(intent)) return texts['N2-N6'] || '';
if (['N7', 'N8', 'N9', 'N10'].includes(intent)) return texts['N7-N10'] || '';
if (['N11', 'N12', 'N13', 'N14', 'N15'].includes(intent)) return texts['N11-N15'] || '';
```

**问题**：态控架构 v5.8 的**核心原则**是"房间比喻"——每个环节是一个独立房间，环节宪法彼此隔离。当前实现让 N3 模型同时看到 N2/N4/N5/N6 的宪法，等于把 5 个房间的墙拆了。

这违反了 v5.8 §3.1.1 的"环节隔离"硬约束（根宪法第 1 条）。

**修复**：
1. 把 5 个合并宪法文件拆成 16 个独立文件（P0 / N1 / N2 / ... / N15）
2. `getConstitutionForIntent` 直接 `texts[intent]`，不做合并
3. 若 L3 物理上就是合并文件，那这是 **L3 生成包本身的设计问题**，需要回到 N12 拆包阶段重做

---

## 二、P1 重要级（应在本轮迭代修复）

### scheduler.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-2 | L269-305 `_runN2DualRole` | 角色二的 systemPrompt 完全没注入 N2 环节宪法，只用了硬编码的审查标准 | 角色二脱离宪法约束，可能输出违反 turnType schema 的内容 |
| P1-3 | L136 `turnIndex + 0.5` | 用浮点当 turn 序号 | conversation_log 的 turn_index 排序/索引失真，FTS5 召回错乱 |
| P1-4 | L171 `transition(route.to, ...intent)` | route.to 是 LISTENING/CLOSING 时仍写入 intent | 状态污染，下次会话恢复时拿到错的 intent |
| P1-5 | L163 `_topicId` | 字段从未被赋值，永远走 `${intent}-${Date.now()}` fallback | topicEvolution 无法跨会话关联同一主题 |

### state-machine.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-6 | L140 `_matchFrom` | `IN_SESSION(topic)` 判定写死 `!['N11','N12']`，没真读 taskType 字段 | 新增 field_based intent 时这里要同步改，违背 L3 数据驱动原则 |

### route-table.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-9 | L71 `getSecondLayerOverride` | 只支持 `intent=X` 精确匹配，不支持 `intent=P0~N10` 范围绑定 | L3 routeTable 第二层若用范围语法就匹配不到 |

### deepseek-adapter.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-11 | L62 `parseAnalyzingResult` | 只取 `content.charAt(0)`，模型若返回带反引号 `` `A` `` 或小写 `a` 会失败 | logprobs 概率失真，ANALYZING 误判 |
| P1-12 | L66 `logprobs.content[0]` | 取的是第一个 token 的 logprob，但若模型先输出空白/BOM，第一个 token 不是字母 | 概率计算错，可能误判为低置信 |
| P1-13 | L86 | `tool_choice:'auto'` 未设 `parallel_tool_calls:false` | DeepSeek 默认并行调用，scheduler 顺序执行结果会错乱 |
| P1-14 | L114 `callCodeModel` | 没注入 tools 参数 | N13 写代码时无法调用 writeOutput 落盘 |

### tool-registry.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-18 | L200 `fullToolIntents` | 硬编码白名单 `['N5','N6','N7','N9','N11','N12','N13']` | L3 routeTable 改了这里不会跟随 |
| P1-19 | L137 `searchOutputs` | 没传 sessionId，可能搜到其他会话内容 | 跨会话信息泄露 |

### index.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-20 | L51 | `process.env.DEEPSEEK_API_KEY = ...` 污染全局 | 多实例互相覆盖 |
| P1-21 | L193 | CLI 模式 `sessionId='cli-session'` 硬编码 | 多次跑 CLI 复用 session，UNIQUE 约束覆盖历史 |

### outputs-manager.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-23 | L33 `strategyFor` | 返回 `'forcedWrite'`/`'write'` 但 scheduler 没用，只判 `isCritical` | 死代码，应删除或让 scheduler 真正使用 |

### l2-l3-validator.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-26 | L32 / L40 | `topicCount===15`、`transitions.length===20`、`routes.length===11` 等数字硬编码 | 新增 intent 时这里全要改，且报错信息不直观 |

### constitutions/loader.js

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| P1-28 | L24 | 硬编码 `'态控架构'` 中文路径 | 跨工作区/跨平台失败 |

---

## 三、P2 建议级（可下轮迭代处理）

| # | 文件 | 问题 | 建议 |
|---|------|------|------|
| P2-5 | scheduler.js L34 | `_n2Role1Output` / `_topicId` 实例字段缺少初始化注释 | 加 JSDoc |
| P2-7 | state-machine.js | `transition()` 不做合法性校验 | dev-mode 加 console.warn |
| P2-8 | route-table.js / state-machine.js | `_matchFrom` 逻辑重复 | 抽到公共 utils |
| P2-15 | deepseek-adapter.js L36 | `max_tokens: 2` 对 ANALYZING 太紧 | 提到 5，留缓冲 |
| P2-22 | index.js | sessionId 为 null 时不报错 | 改成 throw 更明确 |
| P2-24 | telemetry.js | 单例模式共享 metrics | 改成实例字段，MetaAgent 持有 |
| P2-25 | telemetry.js | `_traces` 数组无上限 | 加 LRU，最多保留 1000 条 |
| P2-27 | tunables.js L53-63 | `createDefaultTunables` 中 if/else 两个分支一样 | 删除死分支 |

---

## 四、N14 工具链自身的问题

### P0-4 同源问题：mechanism-check.js L41/L97 用 `require`

```js
const { readFileSync } = require('fs');   // ← ESM 里没有 require
```

mechanism-check.js 是 `.js` 文件且 package.json 应是 `"type":"module"`，这两处 `require` 会直接抛错。但 try-catch 把错吞了，所以测试还是 PASS——**检查通过是假的**。

### simulate.js Mock 覆盖不足

Mock 适配器的 `callInSession` 永远返回 `turnType=complete`，无法测试：
- turnType=ask 分支
- turnType=off-task 分支
- turnType=giveup 分支
- toolCalls 非空分支

**建议**：让 Mock 按 caseId 返回不同 turnType，覆盖 6 种 turnType 全路径。

### static-checker.js checkInlinePrompt 正则太弱

L99 `/\+\s*['"]\n\n.*环节/` 只能匹配特定形式的拼接。scheduler.js L273-305 的 `_runN2DualRole` 已经在直接拼 prompt（角色二的 prompt 是硬编码字符串），但这个检查**没识别出来**。

**建议**：改成"scheduler.js 中除 `_cm.buildContext` 外不应出现 `systemPrompt` 变量赋值"的语义检查。

---

## 五、修复优先级建议

**本周必须修（影响运行）**：
1. P0-1 inSessionResult 声明（1 行修复）
2. P0-2 N2 工具 ctx 引用传递（scheduler + tool-registry 联动改）
3. P0-3 API key 实例化传入（adapter 构造函数改造）
4. P0-4 宪法拆分（需要回到 N12 拆包阶段）

**下周应修（影响设计一致性）**：
5. P1-2 N2 角色二宪法注入
6. P1-13 parallel_tool_calls=false
7. P1-14 N13 工具注入
8. P1-26 l2-l3-validator 数字硬编码

**机制改进（影响 N14 自身可信度）**：
9. mechanism-check.js 的 require 残留（P0-4 同源）
10. simulate.js Mock 覆盖 6 种 turnType

---

## 六、设计层面的反思

这次审核暴露的**最深问题**不是具体 bug，而是：

1. **N14 工具链的 24/24 READY 是假阳性**——机制检查靠 `require` + try-catch 兜底，实际是跳过的。这提示态控架构 v5.8 的 N14 节点需要补一条：**机制检查必须用真实运行验证，不允许 try-catch 兜底通过**。

2. **L2/L3 设计的"环节隔离"在代码层被合并加载违反**——L2 写了 16 份宪法，L3 也拆了 16 份，但 loader 又合并回 5 份。这是 **N12 拆包阶段的产出物在代码层被二次破坏**。建议 N14 审骨架增加一条"代码必须保留 L2/L3 的环节粒度"。

3. **simulate.js 的 Mock 与真实 adapter 行为差距太大**——Mock 永远返回 `turnType=complete`，等于跳过了 5/6 的 turnType 分支。这是 N14 行为测试覆盖不足的根本问题。

---

**审核人**：道师
**审核耗时**：约 25 分钟
**下一步**：等用户决定是否按优先级修复
