# 富贵小安 (fugui-xiaoan)

记账 PWA — "像发微信一样记账"。

## 技术栈
- 纯 JS，零框架依赖
- 态控架构 v3.4：7状态调度器 + 根宪法 + 环节宪法 + DET仲裁
- L1/L2 双防线 + 意图防抖
- 249 条测试，100% 通过率

## 结构
```
/packages/fugui-xiaoan/  — 核心库（26 个模块）
/demos/                  — PWA Demo
/products/               — 产品构建
/docs/                   — 流程文档
/e2e/                    — Playwright E2E 测试
```

## 快速开始
```bash
cd packages/fugui-xiaoan
node test.js
```

MIT License
