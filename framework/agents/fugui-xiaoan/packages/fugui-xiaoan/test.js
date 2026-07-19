// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 — 自包含测试套件
 *
 * 运行方式: node test.js
 * 输出 TAP 风格结果，最后统计通过/失败
 *
 * 覆盖模块: intent-router, clarify, storage, index (核心流程)
 */

import { classifyIntent, classifyQuerySub, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from './src/intent-router.js';
import { createClarifyContext } from './src/clarify.js';
import { ClarifyState } from './src/types.js';
import { MemoryStorage, LocalStorageStorage, EncryptedLocalStorage } from './src/storage.js';
import { FuguiXiaoan } from './src/index.js';

// ═══════════════════════════════════════════════════════
// 自包含测试框架
// ═══════════════════════════════════════════════════════

const TIMEOUT_MS = 2 * 60 * 1000; // 与 clarify.js 保持一致

let passed = 0;
let failed = 0;
let testNum = 0;

function test(name, fn) {
  testNum++;
  const num = testNum; // 捕获编号，避免 async 闭包乱序
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { console.log(`ok ${num} - ${name}`); passed++; },
        (e) => { console.log(`not ok ${num} - ${name}`); console.log(`  ---`); console.log(`  message: ${e.message}`); console.log(`  ---`); failed++; }
      );
    }
    console.log(`ok ${num} - ${name}`);
    passed++;
  } catch (e) {
    console.log(`not ok ${num} - ${name}`);
    console.log(`  ---`);
    console.log(`  message: ${e.message}`);
    console.log(`  ---`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function runTests() {
  // All tests are collected, then run sequentially
  console.log('TAP version 13');
  console.log(`# 富贵小安 测试套件 — ${new Date().toISOString()}\n`);

  const promises = [];

  // ═══════════════════════════════════════════════════
  // 第一部分: intent-router.js
  // ═══════════════════════════════════════════════════
  console.log('# ── intent-router.js ──');

  promises.push(test('classifyIntent "午饭25块" → record', () => {
    const r = classifyIntent('午饭25块');
    assert(r.intent === 'record', `Expected record, got ${r.intent}`);
  }));

  promises.push(test('classifyIntent "这个月花了多少" → query', () => {
    const r = classifyIntent('这个月花了多少');
    assert(r.intent === 'query', `Expected query, got ${r.intent}`);
  }));

  promises.push(test('classifyIntent "删掉去掉午饭" → delete', () => {
    // "删掉"+"去掉" = 2×20=40 分 ≥ 30 阈值 → delete
    const r = classifyIntent('删掉去掉午饭');
    assert(r.intent === 'delete', `Expected delete, got ${r.intent}`);
  }));

  promises.push(test('classifyIntent "你好" → other', () => {
    const r = classifyIntent('你好');
    assert(r.intent === 'other', `Expected other, got ${r.intent}`);
  }));

  promises.push(test('classifyIntent "" → other with confidence 0', () => {
    const r = classifyIntent('');
    assert(r.intent === 'other', `Expected other, got ${r.intent}`);
    assert(r.confidence === 0, `Expected confidence 0, got ${r.confidence}`);
    assert(r.needGuide === true, 'Expected needGuide');
  }));

  promises.push(test('classifyIntent null → other with confidence 0', () => {
    const r = classifyIntent(null);
    assert(r.intent === 'other');
    assert(r.confidence === 0);
  }));

  promises.push(test('classifyIntent 高置信度: 多关键词记账≥80', () => {
    // "记了消费买了吃了25块" → 4 个记账关键词 × 15 = 60, +20(金额模式) +10(有数字) = 90
    const r = classifyIntent('记了消费买了吃了25块');
    assert(r.intent === 'record', `Expected record, got ${r.intent}`);
    assert(r.confidence >= 80, `Expected confidence >= 80, got ${r.confidence}`);
    assert(!r.needGuide, 'Expected no needGuide for high confidence');
    assert(!r.needConfirm, 'Expected no needConfirm for high confidence');
  }));

  promises.push(test('classifyIntent 模糊输入置信度<60', () => {
    const r = classifyIntent('随便');
    assert(r.confidence < 60, `Expected confidence < 60, got ${r.confidence}`);
  }));

  promises.push(test('CONFIDENCE_HIGH === 80', () => {
    assert(CONFIDENCE_HIGH === 80, `Expected 80, got ${CONFIDENCE_HIGH}`);
  }));

  promises.push(test('CONFIDENCE_MEDIUM === 60', () => {
    assert(CONFIDENCE_MEDIUM === 60, `Expected 60, got ${CONFIDENCE_MEDIUM}`);
  }));

  promises.push(test('classifyQuerySub "昨天午饭多少" → single', () => {
    const r = classifyQuerySub('昨天午饭多少');
    assert(r.subIntent === 'single', `Expected single, got ${r.subIntent}`);
  }));

  promises.push(test('classifyQuerySub "这个月总共" → summary', () => {
    const r = classifyQuerySub('这个月总共');
    assert(r.subIntent === 'summary', `Expected summary, got ${r.subIntent}`);
  }));

  promises.push(test('classifyQuerySub "排骨贵了吗" → compare', () => {
    const r = classifyQuerySub('排骨贵了吗');
    assert(r.subIntent === 'compare', `Expected compare, got ${r.subIntent}`);
  }));

  promises.push(test('classifyQuerySub "随便找找" → fuzzy', () => {
    const r = classifyQuerySub('随便找找');
    assert(r.subIntent === 'fuzzy', `Expected fuzzy, got ${r.subIntent}`);
  }));

  promises.push(test('classifyQuerySub "" → fuzzy with confidence 0', () => {
    const r = classifyQuerySub('');
    assert(r.subIntent === 'fuzzy', `Expected fuzzy, got ${r.subIntent}`);
    assert(r.confidence === 0, `Expected 0, got ${r.confidence}`);
  }));

  // ═══════════════════════════════════════════════════
  // 第二部分: clarify.js
  // ═══════════════════════════════════════════════════
  console.log('\n# ── clarify.js ──');

  promises.push(test('createClarifyContext() 返回独立上下文', () => {
    const ctx = createClarifyContext();
    assert(typeof ctx.checkAndAsk === 'function', 'checkAndAsk missing');
    assert(typeof ctx.handleReply === 'function', 'handleReply missing');
    assert(typeof ctx.getState === 'function', 'getState missing');
    assert(typeof ctx.getQuestion === 'function', 'getQuestion missing');
    assert(typeof ctx.cleanTimeouts === 'function', 'cleanTimeouts missing');
    assert(typeof ctx.clear === 'function', 'clear missing');
  }));

  promises.push(test('两个上下文互相隔离', () => {
    const ctxA = createClarifyContext();
    const ctxB = createClarifyContext();

    ctxA.checkAndAsk('id1', '苹果');
    ctxB.checkAndAsk('id2', '香蕉');

    assert(ctxA.getState('id1') === ClarifyState.ASKED, 'ctxA should be ASKED');
    assert(ctxB.getState('id2') === ClarifyState.ASKED, 'ctxB should be ASKED');

    // ctxA 的追问不影响 ctxB 对同一个 id 的判断
    assert(ctxB.getState('id1') === ClarifyState.NORMAL,
      'ctxB should see id1 as NORMAL (isolated)');
  }));

  promises.push(test('checkAndAsk → getState=ASKED → handleReply → getState=NORMAL', () => {
    const ctx = createClarifyContext();

    // 初始状态
    assert(ctx.getState('rec1') === ClarifyState.NORMAL, 'Initial should be NORMAL');

    // 发起追问
    const result = ctx.checkAndAsk('rec1', '苹果');
    assert(result !== null, 'checkAndAsk should return result');
    assert(typeof result.question === 'string', 'question should be string');
    assert(result.question.includes('苹果'), 'question should mention item');
    assert(ctx.getState('rec1') === ClarifyState.ASKED, 'Should be ASKED after checkAndAsk');

    // 处理回复
    const handled = ctx.handleReply('rec1');
    assert(handled === true, 'handleReply should return true');
    assert(ctx.getState('rec1') === ClarifyState.NORMAL, 'Should be NORMAL after handleReply');
  }));

  promises.push(test('handleReply 对不存在/已处理的 id 返回 false', () => {
    const ctx = createClarifyContext();
    assert(ctx.handleReply('nonexistent') === false, 'Should return false for nonexistent');
  }));

  promises.push(test('checkAndAsk 对已在追问中的 id 返回 null', () => {
    const ctx = createClarifyContext();
    ctx.checkAndAsk('id1', 'first');
    const second = ctx.checkAndAsk('id1', 'second');
    assert(second === null, 'Second checkAndAsk should return null');
  }));

  promises.push(test('追问超时 → getState=ABANDONED', () => {
    const ctx = createClarifyContext();
    const origNow = Date.now;
    const baseTime = origNow();

    try {
    Date.now = () => baseTime;
    ctx.checkAndAsk('timeout_id', '测试');

    // 快进超过 2 分钟
    Date.now = () => baseTime + TIMEOUT_MS + 1000;

    const state = ctx.getState('timeout_id');
    assert(state === ClarifyState.ABANDONED,
      `Expected ABANDONED, got ${state}`);
    } finally { Date.now = origNow; }
  }));

  promises.push(test('getQuestion 返回追问文本', () => {
    const ctx = createClarifyContext();
    ctx.checkAndAsk('q1', '排骨');
    const q = ctx.getQuestion('q1');
    assert(q !== null, 'getQuestion should not be null');
    assert(q.includes('排骨'), 'Question should include item text');
  }));

  promises.push(test('getQuestion 对不存在的 id 返回 null', () => {
    const ctx = createClarifyContext();
    assert(ctx.getQuestion('nonexistent') === null);
  }));

  promises.push(test('clear 移除指定追问', () => {
    const ctx = createClarifyContext();
    ctx.checkAndAsk('c1', 'test');
    assert(ctx.getState('c1') === ClarifyState.ASKED);
    ctx.clear('c1');
    assert(ctx.getState('c1') === ClarifyState.NORMAL, 'Should be NORMAL after clear');
  }));

  promises.push(test('cleanTimeouts 清理过期追问', () => {
    const ctx = createClarifyContext();
    const origNow = Date.now;
    const baseTime = origNow();

    // 创建多个追问，其中一些超时
    try {
    Date.now = () => baseTime;
    ctx.checkAndAsk('fresh1', 'a');
    ctx.checkAndAsk('fresh2', 'b');

    // 快进
    Date.now = () => baseTime + TIMEOUT_MS + 2000;
    ctx.cleanTimeouts();

    // 超时的应被清理
    assert(ctx.getState('fresh1') === ClarifyState.NORMAL, 'fresh1 should be cleaned');
    assert(ctx.getState('fresh2') === ClarifyState.NORMAL, 'fresh2 should be cleaned');
    } finally { Date.now = origNow; }
  }));

  // ═══════════════════════════════════════════════════
  // 第三部分: storage.js
  // ═══════════════════════════════════════════════════
  console.log('\n# ── storage.js ──');

  // ── MemoryStorage ──

  promises.push(test('MemoryStorage save 返回含 id 的完整记录', async () => {
    const s = new MemoryStorage();
    const r = await s.save({ text: '午饭25块', item: '午饭', amount: 25 });
    assert(typeof r.id === 'string', 'id should be string');
    assert(r.text === '午饭25块');
    assert(r.item === '午饭');
    assert(r.amount === 25);
    assert(r.clarifyState === 'NORMAL');
    assert(typeof r.createdAt === 'string');
  }));

  promises.push(test('MemoryStorage save 填充默认值', async () => {
    const s = new MemoryStorage();
    const r = await s.save({});
    assert(r.item === '消费');
    assert(r.amount === 0);
    assert(r.text === '');
    assert(r.quantity === null);
    assert(r.unit === null);
    assert(r.unitPrice === null);
  }));

  promises.push(test('MemoryStorage query 按关键词过滤', async () => {
    const s = new MemoryStorage();
    await s.save({ text: '午饭25块', item: '午饭', amount: 25 });
    await s.save({ text: '晚饭50块', item: '晚饭', amount: 50 });
    await s.save({ text: '打车30', item: '打车', amount: 30 });

    const results = await s.query({ keyword: '午饭' });
    assert(results.length === 1, `Expected 1, got ${results.length}`);
    assert(results[0].item === '午饭');
  }));

  promises.push(test('MemoryStorage query 按日期范围过滤', async () => {
    const s = new MemoryStorage();
    const rec = await s.save({
      text: '午饭25块', item: '午饭', amount: 25,
      createdAt: '2026-06-15T12:00:00.000Z',
    });

    const found = await s.query({ startDate: '2026-06-14', endDate: '2026-06-16' });
    assert(found.length === 1, `Expected 1 in range, got ${found.length}`);

    const notFound = await s.query({ startDate: '2026-07-01', endDate: '2026-07-31' });
    assert(notFound.length === 0, `Expected 0 out of range, got ${notFound.length}`);
  }));

  promises.push(test('MemoryStorage query 不区分大小写', async () => {
    const s = new MemoryStorage();
    await s.save({ text: 'LUNCH', item: 'Lunch', amount: 25 });

    const r1 = await s.query({ keyword: 'lunch' });
    assert(r1.length === 1, `Expected 1 for lowercase, got ${r1.length}`);

    const r2 = await s.query({ keyword: 'LUNCH' });
    assert(r2.length === 1, `Expected 1 for uppercase, got ${r2.length}`);
  }));

  promises.push(test('MemoryStorage query 结果按时间倒序', async () => {
    const s = new MemoryStorage();
    await s.save({ text: 'old', item: 'old', amount: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    await s.save({ text: 'new', item: 'new', amount: 20, createdAt: '2026-12-31T00:00:00.000Z' });

    const results = await s.query({});
    assert(results.length === 2);
    assert(results[0].item === 'new', 'Newest should be first');
    assert(results[1].item === 'old', 'Oldest should be last');
  }));

  promises.push(test('MemoryStorage all 返回全部记录', async () => {
    const s = new MemoryStorage();
    await s.save({ item: 'a', amount: 1 });
    await s.save({ item: 'b', amount: 2 });
    const all = await s.all();
    assert(all.length === 2, `Expected 2, got ${all.length}`);
  }));

  promises.push(test('MemoryStorage remove 删除存在记录返回 true', async () => {
    const s = new MemoryStorage();
    const r = await s.save({ item: 'x', amount: 10 });
    const removed = await s.remove(r.id);
    assert(removed === true, 'remove should return true');
    const all = await s.all();
    assert(all.length === 0, 'Should be empty after remove');
  }));

  promises.push(test('MemoryStorage remove 删除不存在记录返回 false', async () => {
    const s = new MemoryStorage();
    const removed = await s.remove('nonexistent_id');
    assert(removed === false, 'remove nonexistent should return false');
  }));

  promises.push(test('MemoryStorage clear 清空所有记录', async () => {
    const s = new MemoryStorage();
    await s.save({ item: 'a', amount: 1 });
    await s.save({ item: 'b', amount: 2 });
    await s.clear();
    const all = await s.all();
    assert(all.length === 0, `Expected 0 after clear, got ${all.length}`);
  }));

  // ── LocalStorageStorage（需要 mock） ──

  promises.push(test('LocalStorageStorage save/query/all/remove/clear', async () => {
    // Mock localStorage
    const store = {};
    const mockLS = {
      getItem(k) { return store[k] || null; },
      setItem(k, v) { store[k] = v; },
      removeItem(k) { delete store[k]; },
    };

    // 模拟全局 localStorage
    const origLS = globalThis.localStorage;
    globalThis.localStorage = mockLS;

    try {
      const s = new LocalStorageStorage('test_ls_key');
      // save
      const r = await s.save({ text: '午饭25块', item: '午饭', amount: 25 });
      assert(typeof r.id === 'string');
      assert(r.item === '午饭');
      assert(r.amount === 25);

      // query
      const found = await s.query({ keyword: '午饭' });
      assert(found.length === 1);
      assert(found[0].item === '午饭');

      // all
      const all = await s.all();
      assert(all.length === 1);

      // remove
      const removed = await s.remove(r.id);
      assert(removed === true);
      assert((await s.all()).length === 0);

      // save again then clear
      await s.save({ item: 'x', amount: 1 });
      await s.clear();
      assert((await s.all()).length === 0);
    } finally {
      globalThis.localStorage = origLS;
    }
  }));

  // ── EncryptedLocalStorage ──

  promises.push(test('EncryptedLocalStorage 构造函数 encryptKey 必填', () => {
    let threw = false;
    try {
      new EncryptedLocalStorage('key', undefined);
    } catch (e) {
      threw = true;
      assert(e.message.includes('encryptKey is required'));
    }
    assert(threw, 'Should throw without encryptKey');
  }));

  promises.push(test('EncryptedLocalStorage 构造函数 encryptKey 为空字符串也抛错', () => {
    let threw = false;
    try {
      new EncryptedLocalStorage('key', '');
    } catch (e) {
      threw = true;
      assert(e.message.includes('encryptKey is required'));
    }
    assert(threw, 'Should throw with empty encryptKey');
  }));

  // ── 接口一致性 ──

  promises.push(test('MemoryStorage 和 LocalStorageStorage save 返回结构一致', async () => {
    const ms = new MemoryStorage();
    const mr = await ms.save({ text: 'test', item: 'test', amount: 10 });

    const store = {};
    const origLS = globalThis.localStorage;
    globalThis.localStorage = {
      getItem(k) { return store[k] || null; },
      setItem(k, v) { store[k] = v; },
    };

    try {
      const ls = new LocalStorageStorage('consistency_test');
      const lr = await ls.save({ text: 'test', item: 'test', amount: 10 });

      const expectedKeys = ['id', 'text', 'item', 'amount', 'quantity', 'unit', 'unitPrice', 'clarifyState', 'createdAt'];
      for (const key of expectedKeys) {
        assert(key in mr, `MemoryStorage save missing key: ${key}`);
        assert(key in lr, `LocalStorageStorage save missing key: ${key}`);
      }

      assert(typeof mr.id === typeof lr.id);
      assert(typeof mr.createdAt === typeof lr.createdAt);
      assert(mr.clarifyState === lr.clarifyState);
    } finally {
      globalThis.localStorage = origLS;
    }
  }));

  // ═══════════════════════════════════════════════════
  // 第四部分: index.js 核心流程
  // ═══════════════════════════════════════════════════
  console.log('\n# ── index.js 核心流程 ──');

  promises.push(test('FuguiXiaoan 实例化默认 simple 模式', () => {
    const xiaoan = new FuguiXiaoan();
    assert(xiaoan instanceof FuguiXiaoan);
    assert(xiaoan.getMode() === 'simple', `Expected simple, got ${xiaoan.getMode()}`);
  }));

  promises.push(test('FuguiXiaoan 实例化可指定 detailed 模式', () => {
    const xiaoan = new FuguiXiaoan({ mode: 'detailed' });
    assert(xiaoan.getMode() === 'detailed');
  }));

  promises.push(test('FuguiXiaoan 实例化可传入自定义 storage', () => {
    const storage = new MemoryStorage();
    const xiaoan = new FuguiXiaoan({ storage });
    assert(xiaoan.storage === storage);
  }));

  promises.push(test('getMode / setMode 切换', () => {
    const xiaoan = new FuguiXiaoan();
    assert(xiaoan.getMode() === 'simple');

    xiaoan.setMode('detailed');
    assert(xiaoan.getMode() === 'detailed');

    xiaoan.setMode('simple');
    assert(xiaoan.getMode() === 'simple');

    // 非法值默认 simple
    xiaoan.setMode('invalid');
    assert(xiaoan.getMode() === 'simple');
  }));

  promises.push(test('getModeLabel 返回中文标签', () => {
    const xiaoan = new FuguiXiaoan();
    assert(xiaoan.getModeLabel() === '简单');

    xiaoan.setMode('detailed');
    assert(xiaoan.getModeLabel() === '细致');
  }));

  promises.push(test('getModeColor 返回主题色', () => {
    const xiaoan = new FuguiXiaoan();
    assert(xiaoan.getModeColor() === '#E8A840');

    xiaoan.setMode('detailed');
    assert(xiaoan.getModeColor() === '#14B8A6');
  }));

  promises.push(test('record("午饭25块") → 记账成功', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.record('午饭25块');
    assert(result.type === 'confirm', `Expected confirm, got ${result.type}`);
    assert(result.message.includes('已记录'));
    assert(result.message.includes('午饭'));
    assert(result.message.includes('25'));
    assert(result.record.item === '午饭');
    assert(result.record.amount === 25);
  }));

  promises.push(test('record 包含数量+单位的输入 → 成功', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.record('买了三斤苹果45元');
    assert(result.type === 'confirm', `Expected confirm, got ${result.type}`);
    assert(result.record.amount === 45);
    assert(result.record.quantity === 3);
    assert(result.record.unit === '斤');
    // parser 将 "三斤苹果" 作为 item（数量词未从描述中剥离）
    assert(result.record.item.includes('苹果'), `item should include '苹果', got: ${result.record.item}`);
  }));

  promises.push(test('record 无金额只有数量 → 返回 clarify（追问金额）', async () => {
    const xiaoan = new FuguiXiaoan();
    // "三个苹果" 不含数字金额，但含中文数字 → parse 返回 amount=null
    const result = await xiaoan.record('三个苹果');
    assert(result.type === 'clarify', `Expected clarify, got ${result.type}: ${result.message}`);
    assert(result.message.includes('花了多少钱'));
  }));

  promises.push(test('record 无法理解 → 返回 error', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.record('你好吗');
    assert(result.type === 'error', `Expected error, got ${result.type}`);
  }));

  promises.push(test('record 空字符串 → error', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.record('');
    assert(result.type === 'error', `Expected error, got ${result.type}`);
  }));

  promises.push(test('record 追问回复流程（金额追问）', async () => {
    const xiaoan = new FuguiXiaoan();

    // 第一步：触发追问
    const r1 = await xiaoan.record('三个苹果');
    assert(r1.type === 'clarify', `Step 1: Expected clarify, got ${r1.type}`);

    // 第二步：回复金额
    const r2 = await xiaoan.record('45块');
    assert(r2.type === 'confirm', `Step 2: Expected confirm, got ${r2.type}`);
    assert(r2.message.includes('已补全'));
  }));

  promises.push(test('detailed 模式：有金额无数量 → 追问数量', async () => {
    const xiaoan = new FuguiXiaoan({ mode: 'detailed' });
    const result = await xiaoan.record('午饭25块');
    assert(result.type === 'clarify', `Expected clarify, got ${result.type}: ${result.message}`);
    assert(result.message.includes('买了多少'));
    assert(result.needQuantity === true);
  }));

  promises.push(test('detailed 模式：追问数量后回复 → 补全成功', async () => {
    const xiaoan = new FuguiXiaoan({ mode: 'detailed' });

    const r1 = await xiaoan.record('午饭25块');
    assert(r1.type === 'clarify');
    assert(r1.needQuantity === true);

    // "份" 不在 QTY_RE 单位列表中，用 "斤"
    const r2 = await xiaoan.record('2斤');
    assert(r2.type === 'confirm', `Expected confirm, got ${r2.type}: ${r2.message}`);
    assert(r2.message.includes('已补全'));
    assert(r2.record.quantity === 2);
    assert(r2.record.unit === '斤');
  }));

  promises.push(test('delete 无匹配 → 返回提示', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.delete('删掉午饭');
    assert(result.type === 'result', `Expected result, got ${result.type}`);
    assert(result.message.includes('没有找到'));
  }));

  promises.push(test('delete 匹配一条 → 需要二次确认', async () => {
    const xiaoan = new FuguiXiaoan();
    await xiaoan.record('午饭25块');

    const result = await xiaoan.delete('删掉午饭');
    assert(result.type === 'clarify', `Expected clarify, got ${result.type}`);
    assert(result.needConfirm === true);
    assert(result.message.includes('确认删除'));
    assert(result.record.item === '午饭');
  }));

  promises.push(test('delete 二次确认后执行删除', async () => {
    const xiaoan = new FuguiXiaoan();
    const r = await xiaoan.record('午饭25块');

    // 第一次：需要确认
    const d1 = await xiaoan.delete('删掉午饭');
    assert(d1.type === 'clarify');
    assert(d1.needConfirm === true);

    // 第二次：确认删除
    const d2 = await xiaoan.delete('删掉午饭', { confirmed: true, targetId: d1.record.id });
    assert(d2.type === 'confirm', `Expected confirm, got ${d2.type}`);
    assert(d2.message.includes('已删除'));
    assert(d2.message.includes('午饭'));

    // 验证已删除
    const all = await xiaoan.getAllRecords();
    assert(all.length === 0, `Expected 0 records, got ${all.length}`);
  }));

  promises.push(test('getAllRecords 返回所有记录', async () => {
    const xiaoan = new FuguiXiaoan();
    const initial = await xiaoan.getAllRecords();
    assert(initial.length === 0, 'Should start empty');

    await xiaoan.record('午饭25块');
    await xiaoan.record('晚饭50块');

    const all = await xiaoan.getAllRecords();
    assert(all.length === 2, `Expected 2, got ${all.length}`);
  }));

  promises.push(test('clearAll 清空所有数据', async () => {
    const xiaoan = new FuguiXiaoan();
    await xiaoan.record('午饭25块');
    await xiaoan.record('晚饭50块');

    await xiaoan.clearAll();
    const all = await xiaoan.getAllRecords();
    assert(all.length === 0, `Expected 0 after clearAll, got ${all.length}`);
  }));

  promises.push(test('record 被识别为查询 → 路由到 query', async () => {
    const xiaoan = new FuguiXiaoan();
    // 先记一笔
    await xiaoan.record('午饭25块');

    // "这个月花了多少" 匹配 isQuery 正则 → 路由到 query
    const result = await xiaoan.record('这个月花了多少');
    // query 调用 classifyQuerySub，confidence 低于 MEDIUM → 返回引导
    assert(result.type === 'result' || result.type === 'clarify',
      `Expected result or clarify, got ${result.type}: ${result.message}`);
  }));

  // ── 边界情况 ──

  promises.push(test('同一实例多次 record 不互相干扰', async () => {
    const xiaoan = new FuguiXiaoan();
    await xiaoan.record('午饭25块');
    await xiaoan.record('晚饭50块');
    await xiaoan.record('打车30');

    const all = await xiaoan.getAllRecords();
    assert(all.length === 3, `Expected 3, got ${all.length}`);
  }));

  promises.push(test('多笔拆分记账', async () => {
    const xiaoan = new FuguiXiaoan();
    const result = await xiaoan.record('打车30，午饭25');
    assert(result.type === 'confirm', `Expected confirm, got ${result.type}`);
    assert(result.records.length === 2);
    assert(result.message.includes('2 笔'));
  }));

  // ═══════════════════════════════════════════════════
  // 收尾: 等待所有 async tests 完成
  // ═══════════════════════════════════════════════════

  await Promise.all(promises);

  // 输出总结
  const total = passed + failed;
  console.log(`\n# ── 测试完成 ──`);
  console.log(`# 总计: ${total} 条`);
  console.log(`# 通过: ${passed} 条`);
  console.log(`# 失败: ${failed} 条`);
  console.log(`# 通过率: ${total > 0 ? Math.round((passed / total) * 100) : 0}%`);

  if (failed > 0) {
    console.log(`\n# ⚠ ${failed} 条测试失败，请检查上方输出`);
    process.exitCode = 1;
  } else {
    console.log(`\n# ✓ 全部通过!`);
  }
}

runTests().catch(e => {
  console.error('测试运行异常:', e);
  process.exit(1);
});
