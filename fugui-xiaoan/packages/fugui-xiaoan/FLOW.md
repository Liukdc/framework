# 富贵小安 v2.0 完整流程表

## 一、系统架构

```
用户输入 → handleInput() → 状态路由 → 业务逻辑 → _say() → LLM(DeepSeek) → 回复用户
                                            ↑                        │
                                            └─ 无Key: 报错提示 ──────┘
```

**两调用模式**：
- 调用1（解析）：`parseWithDeepSeek(text)` → 提取 {intent, category, amount, date}
- 调用2（话术）：`generateReply(stateKey, ctx)` → 生成对应状态的自然语言回复

---

## 二、状态机

| 状态 | 含义 | 合法用户输入 | 结束后→ |
|------|------|-------------|---------|
| IDLE | 睡着 | 唤醒词 | LISTENING |
| LISTENING | 醒了，等你说话 | 任何记账/查询/退出 | ANALYZING（或CLOSING） |
| ANALYZING | ⚡瞬时（调LLM解析） | — | CLARIFYING/EXECUTING/query |
| CLARIFYING | 追问缺字段 | 回答追问 / 算了 | CLARIFYING/executing/LISTENING |
| EXECUTING | 正在记账 | — | LISTENING |
| CLOSING | 说拜拜中 | — | IDLE（2秒后） |

---

## 三、handleInput() 入口流程

```
用户输入 text
    │
    ├─ 为空? → return
    │
    ├─ 是"算了/不记了"? ─┬─ 当前状态==CLARIFYING → _say('cancel_current') → 回LISTENING
    │                   └─ 其他状态 → _doClose()
    │
    └─ 按状态路由:
         IDLE/WAITING_WAKE ───→ _handleWake(t)
         LISTENING ───────────→ _handleListening(t)
         CLARIFYING ──────────→ _handleClarifyAnswer(t)
         其他(兜底) ──────────→ _handleWake(t)
```

---

## 四、各状态处理器

### 4.1 _handleWake(t) — IDLE态

```
匹配唤醒词? (小安出来记一下/记账/...)
    ├─ YES → _setState(LISTENING) → _say('wake') → 输出
    └─ NO  → 硬编码: "您可以先说『小安出来记一下』叫醒我。"
```

### 4.2 _handleListening(t) — LISTENING态（主入口）

```
t = t.trim().toLowerCase()

第1关：撤销
  是"记错了/不对/改一下"?
    → 删上条 (_xiaoan.delete)
    → _clarifyQueue = ['category','amount','time']
    → _setState(CLARIFYING) → _say('ask_category')

第2关：退出
  是"退出/拜拜/再见/记完了/没有了/好了/不记*"?
    → _doClose()

第3关：意图分析
  _setState(ANALYZING) → "…"

  ├─ 有 LLM(llmCall)?
  │    ├─ 调用 parseWithDeepSeek(t)
  │    ├─ 成功? confidence≥0.5?
  │    │    ├─ result.intent=='query' → _handleQuery(t)
  │    │    └─ result.intent=='record' → extracted={category,amount,date}
  │    └─ 失败 → classifyIntent(t) 本地兜底
  │
  └─ 无 LLM → classifyIntent(t) 本地关键词匹配

第4关：按意图分流
  intent=='record' → _startRecord(t, extracted)
  intent=='query'  → _handleQuery(t)
  intent=='delete' → _handleDelete(t)
  intent=='other'  → _handleOther()
```

### 4.3 _startRecord + _checkAndClarify — 记账流程

```
_startRecord(text, llmExtracted):
  1. parse(text) → 本地正则提取 {item, amount, time}
  2. 字段优先级: parsed.item > parsed.category > llm.category > llm.item
  3. 时间不默认"今天"（null→追问）
  4. _checkAndClarify()

_checkAndClarify():
  遍历 requiredFields ['category','amount','time']
  缺失的加入 _clarifyQueue

  clarifyQueue为空?
    → _doRecord()  直接记账

  clarifyQueue不为空?
    → next = queue[0]
    → stateKey = 'ask_' + next  (ask_category/ask_amount/ask_time)
    → _setState(CLARIFYING)
    → _say(stateKey)  LLM生成追问话术
```

### 4.4 _handleClarifyAnswer(t) — CLARIFYING态

```
字段填值逻辑：

field=='category': this._fields.category = text
field=='amount':   从text提取数字 → 提取不到则再问
field=='time':     this._fields.time = text || '今天'
field=='quantity': 提取数字+单位 → 提取不到则再问

填完后:
  clarifyQueue还有剩余? → _checkAndClarify() 继续追问下一个
  clarifyQueue为空?    → _doRecord() 记账
```

### 4.5 _doRecord() — 执行记账

```
1. _setState(EXECUTING)
2. 调 FuguiXiaoan.record("${cat} ${amt}") → 存到storage
3. 记录 _lastRecord（供撤销用）
4. _say('done_record') → LLM生成"记好啦"话术
5. 清_fields → _setState(LISTENING) 等下一个指令
```

### 4.6 _handleQuery(t) — 查询流程

```
1. _xiaoan.getAllRecords()
2. 从text提取关键词：去掉"花了多少/查/多少"等
3. 模糊搜索：匹配 item/category/name/content
4. 有"花了/多少/一共/总共/汇总/合计"?
     → 汇总模式：算总和，列明细
     否则 → 列表模式：列出匹配记录
5. 状态保持在LISTENING
```

### 4.7 _handleDelete(t) — 删除流程

```
1. 从text去掉 "删/删除/去掉/不要了" 提取关键词
2. _xiaoan.query(kw) 搜索
3. 找到? → 展示 + 返回 {confirmDelete: true}
4. UI层 confirm → confirmDelete() 执行删除
```

### 4.8 _handleOther() — 其他

```
_say('other') → LLM生成 "小安只会记账哦"
```

### 4.9 _doClose() — 退出

```
1. 清空 fields/clarifyQueue
2. _say('close') → LLM生成告别话术
3. CLOSING → 2秒后 → IDLE
```

---

## 五、LLM调用点汇总

| # | 调用 | prompt模板 | 调用次数 |
|---|------|-----------|---------|
| 1 | parseWithDeepSeek(t) | nlu.js PROMPT_TEMPLATE | 每次LISTENING 1次 |
| 2 | _say('wake') | state-llm wake | 唤醒时1次 |
| 3 | _say('ask_category') | state-llm ask_category | 缺种类时1次 |
| 4 | _say('ask_amount') | state-llm ask_amount | 缺金额时1次 |
| 5 | _say('ask_time') | state-llm ask_time | 缺时间时1次 |
| 6 | _say('done_record') | state-llm done_record | 记完1次 |
| 7 | _say('close') | state-llm close | 退出1次 |
| 8 | _say('cancel_current') | state-llm cancel_current | 算了1次 |
| 9 | _say('other') | state-llm other | 闲聊1次 |

**每次对话最少2次LLM调用（解析+话术），追问多一次多1次。**

---

## 六、当前已知问题

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 1 | parser.item优先级高于LLM，LLM result.category(原话)被覆盖 | "猫粮"可能变"购物" | ⚠️ parser优先策略已修复 |
| 2 | 无API Key时_say()返回空字符串，小安不说话只提示 | 不配Key完全不可用 | ✅ 符合设计 |
| 3 | 查询是本地关键词匹配，没有用LLM做语义理解 | "猫花了多少"能工作但不智能 | ⚠️ 待LLM化 |
| 4 | _handleWake非唤醒词回复仍为硬编码 | 风格不统一 | ⚠️ 小问题 |
| 5 | forceClose()话术仍未走LLM | 风格不统一 | ⚠️ 小问题 |
| 6 | state-llm.js每个状态独立调一次LLM（max_tokens=80） | 成本极低但延迟累积 | ✅ 可接受 |
