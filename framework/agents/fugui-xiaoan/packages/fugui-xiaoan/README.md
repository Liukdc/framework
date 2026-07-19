# 富贵小安 — 基于自然语言的反分类记账核心库

> 像发微信一样记账的纯逻辑引擎。不依赖大模型，不依赖云端。

## 核心理念

所有记账软件都在卷「分类有多智能」——AI 自动分类、语音分类、截图分类。

富贵小安走了一条完全相反的路：**不做分类。**

用户说「午饭25块」，系统只记录 `{item:"午饭", amount:25}`，不映射到任何会计科目。查询时直接在原始文本中做关键词匹配。

详见专利交底书 [#10](https://github.com/Liukdc/ai-interaction-infrastructure) 和完整 Spec。

## 模块结构

```
src/
├── index.js          # FuguiXiaoan 主入口（组装所有模块）
├── types.js          # 类型定义（ClarifyState 枚举 + JSDoc）
├── parser.js         # 自然语言解析（金额/数量/项目）
├── clarify.js        # 追问状态机（只问一次 → 超时放弃）
├── storage.js        # 存储抽象 + 内存实现（可扩展 IndexedDB）
├── query.js          # 查询引擎（时间范围 + 同义词扩展）
├── query-time.js     # 中文时间词解析
├── price-compare.js  # 单价计算 + 历史价格对比
└── synonyms.js       # 同义词管理（7组80+关键词）
```

## 快速上手

```javascript
import { FuguiXiaoan, createMemoryStorage } from 'fugui-xiaoan';

const xiaoan = new FuguiXiaoan({ storage: createMemoryStorage() });

// 记账
const r1 = await xiaoan.record('午饭25块');
console.log(r1.message); // "已记录：午饭 25元"

const r2 = await xiaoan.record('买了三斤苹果45元');
console.log(r2.message); // "已记录：苹果 45元（单价15元/斤）"

// 查询
const q = await xiaoan.query('这个月花了多少');
console.log(q.message); // "本月共 2 笔，合计 70.00 元"
```

## 存储后端

默认提供 `MemoryStorage`（内存存储，适合测试和 Demo）。可以自己实现 `StorageBackend` 接口适配 IndexedDB、LocalStorage 或远程 API。

```javascript
import { StorageBackend } from 'fugui-xiaoan';

class MyStorage extends StorageBackend {
  async save(record) { /* ... */ }
  async query({ keyword, startDate, endDate }) { /* ... */ }
  async all() { /* ... */ }
  async remove(id) { /* ... */ }
  async clear() { /* ... */ }
}
```

## Demo

运行 `demos/fugui-xiaoan/index.html` 查看完整交互演示。

## 许可

MIT — 详见仓库根目录 LICENSE。
