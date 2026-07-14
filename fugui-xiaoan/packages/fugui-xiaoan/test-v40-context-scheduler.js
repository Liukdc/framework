// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * v4.0 上下文管理器 + 调度器状态机 测试套件
 *
 * 运行方式: node test-v40-context-scheduler.js
 * 覆盖模块: context-manager.js, state-machine.js
 */

import { ContextManager } from './src/context-manager.js';
import { Scheduler, State } from './src/state-machine.js';
import { resetTunables } from './src/tunables.js';

// ═══════════════════════════════════════════════════════
// 自包含测试框架
// ═══════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let testNum = 0;

function test(name, fn) {
  testNum++;
  const num = testNum;
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
  console.log('TAP version 13');
  console.log(`# v4.0 上下文管理器 + 调度器状态机 测试 — ${new Date().toISOString()}\n`);

  const promises = [];

  // ═══════════════════════════════════════════════════
  // 第一部分: context-manager.js
  // ═══════════════════════════════════════════════════
  console.log('# ── context-manager.js ──');

  // 1. constructor 初始化 + turns 为空
  promises.push(test('constructor 初始化 turns 为空', () => {
    const cm = new ContextManager();
    assert(Array.isArray(cm.turns));
    assert(cm.turns.length === 0);
    assert(cm.protectedCount === 0);
  }));

  // 2. addTurn 添加正常轮次
  promises.push(test('addTurn 添加 user 轮次', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '猫粮25块', { category: '猫粮', amount: 25 }, 'ask');
    assert(cm.turns.length === 1);
    assert(cm.turns[0].role === 'user');
    assert(cm.turns[0].content === '猫粮25块');
    assert(cm.turns[0].importance === 'normal');
  }));

  // 3. addTurn 含 importance
  promises.push(test('addTurn critical importance', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '重要', {}, null, { importance: 'critical' });
    assert(cm.turns[0].importance === 'critical');
  }));

  // 4. fieldLevelHardGate 保护指定轮次
  promises.push(test('fieldLevelHardGate 保护指定轮次', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '猫粮25块');
    cm.addTurn('assistant', '多少钱？');
    cm.fieldLevelHardGate(0);
    assert(cm.protectedCount === 1);
  }));

  // 5. fieldLevelHardGate 无效索引不抛错
  promises.push(test('fieldLevelHardGate 无效索引不抛错', () => {
    const cm = new ContextManager();
    cm.fieldLevelHardGate(-1);
    cm.fieldLevelHardGate(100);
    assert(cm.protectedCount === 0);
  }));

  // 6. _scoreMatch 相同文本 → 高分
  promises.push(test('_scoreMatch 相同文本 → >0.9', () => {
    const cm = new ContextManager();
    const score = cm._scoreMatch('猫粮25块', '猫粮25块');
    assert(score > 0.9, `Expected >0.9, got ${score}`);
  }));

  // 7. _scoreMatch 完全无关 → 0
  promises.push(test('_scoreMatch 完全无关 → 0', () => {
    const cm = new ContextManager();
    const score = cm._scoreMatch('猫粮', '飞机');
    assert(score === 0, `Expected 0, got ${score}`);
  }));

  // 8. _scoreMatch 中文 bigram 匹配
  promises.push(test('_scoreMatch "猫粮" vs "猫粮多少钱" → >0', () => {
    const cm = new ContextManager();
    const score = cm._scoreMatch('猫粮', '猫粮多少钱');
    assert(score > 0, `Expected >0, got ${score}`);
  }));

  // 9. _scoreMatch 空字符串 → 0
  promises.push(test('_scoreMatch 空字符串 → 0', () => {
    const cm = new ContextManager();
    assert(cm._scoreMatch('', '猫粮') === 0);
    assert(cm._scoreMatch('猫粮', '') === 0);
    assert(cm._scoreMatch('', '') === 0);
  }));

  // 10. buildPromptContext: 当前 query 始终保留
  promises.push(test('buildPromptContext: 当前 query 始终保留', () => {
    const cm = new ContextManager({ maxTurns: 20, tokenBudget: 3000 });
    const result = cm.buildPromptContext('猫粮25块', { category: '猫粮' });
    assert(typeof result.context === 'string');
    assert(result.context.includes('猫粮25块'));
  }));

  // 11. buildPromptContext: collectedFields 注入
  promises.push(test('buildPromptContext: collectedFields 注入', () => {
    const cm = new ContextManager();
    const result = cm.buildPromptContext('新输入', { category: '猫粮', amount: 25 });
    assert(result.context.includes('已采集'));
    assert(result.context.includes('猫粮'));
    assert(result.context.includes('amount:25'));
  }));

  // 12. buildPromptContext: 空 collectedFields
  promises.push(test('buildPromptContext: 空 collectedFields 不注入摘要', () => {
    const cm = new ContextManager();
    const result = cm.buildPromptContext('新输入', {});
    assert(!result.context.includes('已采集'));
  }));

  // 13. buildPromptContext: 返回结构完整
  promises.push(test('buildPromptContext: 返回 {context, turnsKept, estimatedTokens, protectedCount}', () => {
    const cm = new ContextManager();
    const result = cm.buildPromptContext('测试', {});
    assert('context' in result);
    assert('turnsKept' in result);
    assert('estimatedTokens' in result);
    assert('protectedCount' in result);
    assert(typeof result.estimatedTokens === 'number');
  }));

  // 14. archiveContext: 归档后清空普通轮次保留 critical/high
  promises.push(test('archiveContext: 归档后清空但保留 critical/high', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '普通', {}, null, { importance: 'normal' });
    cm.addTurn('user', '重要', {}, null, { importance: 'critical' });
    cm.addTurn('user', '高优先', {}, null, { importance: 'high' });
    const result = cm.archiveContext();
    assert(result.archivedCount >= 2); // critical + high
    assert(result.remainingCount <= 1); // only normal
  }));

  // 15. archiveContext: 带 keepProtected
  promises.push(test('archiveContext keepProtected=false 不保留受保护', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '普通');
    cm.fieldLevelHardGate(0);
    const result = cm.archiveContext({ keepProtected: false });
    assert(result.archivedCount === 0);
  }));

  // 16. injectOffTaskSuspicion: 偏离标记注入
  promises.push(test('injectOffTaskSuspicion: 注入偏离标记', () => {
    const cm = new ContextManager();
    cm.injectOffTaskSuspicion({
      userInput: '查一下账单',
      offTaskSuspicion: 'query',
      time: Date.now(),
    });
    const result = cm.buildPromptContext('当前', {});
    assert(result.context.includes('偏离检测'));
  }));

  // 17. positionDecay 范围合理
  promises.push(test('_positionDecay: 距离0 → 1.0', () => {
    const cm = new ContextManager({ maxTurns: 20 });
    const decay = cm._positionDecay(0);
    assert(decay === 1.0, `Expected 1.0, got ${decay}`);
  }));

  // 18. positionDecay 边界
  promises.push(test('_positionDecay: 距离=maxTurns → 0', () => {
    const cm = new ContextManager({ maxTurns: 20 });
    const decay = cm._positionDecay(20);
    assert(decay === 0, `Expected 0, got ${decay}`);
  }));

  // 19. clearHardGates 清除所有保护
  promises.push(test('clearHardGates 清除所有保护', () => {
    const cm = new ContextManager();
    cm.addTurn('user', 'a');
    cm.addTurn('user', 'b');
    cm.fieldLevelHardGate(0);
    cm.fieldLevelHardGate(1);
    assert(cm.protectedCount === 2);
    cm.clearHardGates();
    assert(cm.protectedCount === 0);
  }));

  // 20. reset 完全重置
  promises.push(test('reset 完全重置上下文管理器', () => {
    const cm = new ContextManager();
    cm.addTurn('user', '数据', {}, null, { importance: 'critical' });
    cm.injectOffTaskSuspicion({ userInput: 'x', offTaskSuspicion: 'y', time: Date.now() });
    cm.fieldLevelHardGate(0);
    cm.reset();
    assert(cm.turns.length === 0);
    assert(cm.protectedCount === 0);
  }));

  // 21. setCurrentRoom / getSnapshot
  promises.push(test('setCurrentRoom + getSnapshot', () => {
    const cm = new ContextManager();
    cm.setCurrentRoom('record_123');
    const snap = cm.getSnapshot();
    assert(snap.currentRoom === 'record_123');
    assert(snap.totalTurns === 0);
  }));

  // 22. buildPromptContext: 评分通道 summary form
  promises.push(test('buildPromptContext: 相似轮次产生摘要形态', () => {
    const cm = new ContextManager({ maxTurns: 20, tokenBudget: 3000 });
    cm.addTurn('user', '猫粮25块');
    cm.addTurn('assistant', '记好了');
    const result = cm.buildPromptContext('猫粮多少钱', {});
    // 应该包含至少一个匹配轮次
    assert(result.turnsKept >= 1);
  }));

  // ═══════════════════════════════════════════════════
  // 第二部分: state-machine.js (Scheduler)
  // ═══════════════════════════════════════════════════
  console.log('\n# ── state-machine.js (Scheduler) ──');

  resetTunables();

  // 23. State 枚举 8 个值完整
  promises.push(test('State 枚举 8 个值完整（含 CLOSING）', () => {
    const values = Object.values(State);
    assert(values.length === 8, `Expected 8, got ${values.length}`);
    assert(values.includes('idle'));
    assert(values.includes('listening'));
    assert(values.includes('analyzing'));
    assert(values.includes('in_session'));
    assert(values.includes('clarifying'));
    assert(values.includes('waiting_confirm'));
    assert(values.includes('executing'));
    assert(values.includes('closing'));
    assert(Object.isFrozen(State));
  }));

  // 24. constructor 初始 IDLE
  promises.push(test('Scheduler constructor 初始 IDLE', () => {
    const s = new Scheduler();
    assert(s.state === State.IDLE);
    assert(s.activeIntent === null);
  }));

  // 25. IDLE + 非唤醒 → 保持 IDLE
  promises.push(test('IDLE + 非唤醒 → 保持 IDLE', async () => {
    const s = new Scheduler();
    const r = await s.handleInput('随便说说');
    assert(r.state === State.IDLE);
  }));

  // 26. IDLE + "小安开账" → LISTENING
  promises.push(test('IDLE + "小安开账" → LISTENING', async () => {
    const s = new Scheduler();
    const r = await s.handleInput('小安开账');
    assert(r.state === State.LISTENING);
  }));

  // 27. 口令层: "结束并且退出" → CLOSING → IDLE
  promises.push(test('口令层: "结束并且退出" → CLOSING → IDLE', async () => {
    const s = new Scheduler();
    await s.handleInput('小安开账');
    assert(s.state === State.LISTENING);
    await s.handleInput('结束并且退出');
    assert(s.state === State.IDLE);
  }));

  // 28. 口令层: "本次动作取消" → giveup → LISTENING
  promises.push(test('口令层: IN_SESSION "本次动作取消" → LISTENING', async () => {
    // 模拟进入 IN_SESSION
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？' }),
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮');
    // 现在应该在 IN_SESSION
    assert(s.state === State.IN_SESSION, `Expected IN_SESSION, got ${s.state}`);
    await s.handleInput('本次动作取消');
    assert(s.state === State.LISTENING, `Expected LISTENING, got ${s.state}`);
  }));

  // 29. LISTENING + 非口令输入 → ANALYZING → 识别
  promises.push(test('LISTENING + 非口令 → 意图识别路由', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮', amount: 25 } }),
      createSession: async () => ({ turnType: 'complete', message: '已记录猫粮25元', result: { category: '猫粮', amount: 25, time: '昨天' } }),
      executeRecord: async () => {},
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮25');
    assert(r.state === State.LISTENING, `Expected LISTENING after complete, got ${r.state}`);
  }));

  // 30. ANALYZING confidence≥80 → IN_SESSION
  promises.push(test('ANALYZING confidence≥80 → IN_SESSION', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: {} }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？' }),
    });
    await s.handleInput('小安开账');
    await s.handleInput('记个账');
    assert(s.state === State.IN_SESSION);
  }));

  // 31. ANALYZING confidence 60-80 → 确认后 LISTENING
  promises.push(test('ANALYZING confidence 60-80 → 确认后 LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 70, subType: null, extracted: {} }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('记个账');
    assert(r.state === State.LISTENING);
    assert(r.reply !== '');
  }));

  // 32. ANALYZING confidence<60 → 引导
  promises.push(test('ANALYZING confidence<60 → 引导后 LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'other', confidence: 30, subType: null, extracted: {} }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('...');
    assert(r.state === State.LISTENING);
  }));

  // 33. _dispatchTurn: ASK → 保持 IN_SESSION
  promises.push(test('_dispatchTurn ASK → 保持 IN_SESSION', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？', askingField: 'amount' }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮');
    assert(r.state === State.IN_SESSION, `Expected IN_SESSION, got ${r.state}`);
  }));

  // 34. _dispatchTurn: COMPLETE → DET 复验 → EXECUTING → LISTENING
  promises.push(test('_dispatchTurn COMPLETE → DET 复验 → 执行后 LISTENING', async () => {
    let executed = false;
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮', amount: 25, time: '昨天' } }),
      createSession: async () => ({ turnType: 'complete', message: '已记录', result: { category: '猫粮', amount: 35, time: '昨天' } }),
      executeRecord: async () => { executed = true; },
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮25');
    assert(executed === true, 'executeRecord should have been called');
    assert(r.state === State.LISTENING, `Expected LISTENING, got ${r.state}`);
  }));

  // 35. _dispatchTurn: VALIDATION_FAILED → CLARIFYING
  promises.push(test('_dispatchTurn VALIDATION_FAILED → CLARIFYING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({
        turnType: 'validation_failed',
        message: '金额不对',
        askingField: 'amount',
        validationResult: { field: 'amount', issue: 'amount_invalid', userInput: '0' },
      }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮0元');
    assert(r.state === State.CLARIFYING, `Expected CLARIFYING, got ${r.state}`);
  }));

  // 36. _dispatchTurn: OFF_TASK → 重新 ANALYZING
  promises.push(test('_dispatchTurn OFF_TASK → 重新 ANALYZING', async () => {
    let callCount = 0;
    const s = new Scheduler({
      identifyIntent: async () => {
        callCount++;
        if (callCount === 1) return { intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } };
        return { intent: 'query', confidence: 85, subType: 'single', extracted: {} };
      },
      createSession: async (params) => {
        if (callCount === 1) return { turnType: 'off-task', offTaskInput: params.userInput, collectedFields: { category: '猫粮' } };
        return { turnType: 'ask', message: '查哪天的？' };
      },
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮');
    // OFF_TASK → ANALYZING → identifyIntent again → may enter IN_SESSION
    assert(r.state === State.IN_SESSION || r.state === State.LISTENING);
  }));

  // 37. _dispatchTurn: GIVEUP → LISTENING
  promises.push(test('_dispatchTurn GIVEUP → LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: {} }),
      createSession: async () => ({ turnType: 'giveup', message: '不记了' }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('算了');
    assert(r.state === State.LISTENING);
  }));

  // 38. DET 值域复验: amount≤0 → rejected
  promises.push(test('DET 值域复验 COMPLETE amount=0 → CLARIFYING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'complete', message: '已记录', result: { category: '猫粮', amount: 0, time: '昨天' } }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮0元');
    assert(r.state === State.CLARIFYING, `Expected CLARIFYING for amount=0, got ${r.state}`);
  }));

  // 39. DET 值域复验: amount>999999 → rejected
  promises.push(test('DET 值域复验 amount=1000000 → CLARIFYING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'complete', message: '已记录', result: { category: '猫粮', amount: 1000000, time: '昨天' } }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮100万');
    assert(r.state === State.CLARIFYING, `Expected CLARIFYING for huge amount, got ${r.state}`);
  }));

  // 40. DET 值域复验: 正常值 → valid
  promises.push(test('DET 值域复验 amount=35, time=昨天 → valid → 执行', async () => {
    let executed = false;
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮', amount: 35, time: '昨天' } }),
      createSession: async () => ({ turnType: 'complete', message: '已记录', result: { category: '猫粮', amount: 35, time: '昨天' } }),
      executeRecord: async () => { executed = true; },
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮35');
    assert(executed === true, 'executeRecord should be called');
    assert(r.state === State.LISTENING);
  }));

  // 41. 意图防抖 ≥3 切换 → 锁定
  promises.push(test('意图防抖 ≥3 切换 → 锁定', async () => {
    // 使用 medium confidence (60-80) 使每次输入后停留在 LISTENING，这样才能经过 anti-flap
    const intents = ['record', 'query', 'record'];
    let idx = 0;
    const s = new Scheduler({
      identifyIntent: async () => {
        const intent = intents[idx] || 'other';
        idx++;
        return { intent, confidence: 70, subType: null, extracted: {} };
      },
    });
    await s.handleInput('小安开账');
    await s.handleInput('a'); // record (70 → confirm → LISTENING)
    await s.handleInput('b'); // query (70 → confirm → LISTENING), 2nd switch
    const r = await s.handleInput('c'); // record (70 → anti-flap locked → confirm → LISTENING)
    assert(r.state === State.LISTENING);
    assert(s._antiFlapLocked === true, `Expected antiFlapLocked=true, got ${s._antiFlapLocked}`);
  }));

  // 42. 冷启动窗口软拦截
  promises.push(test('冷启动窗口期 coldStartSessionCount 递增', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？' }),
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮');
    assert(s._coldStartSessionCount === 1);
  }));

  // 43. L2 禁用语扫描
  promises.push(test('L2 禁用语 "您还可以" → 兜底文本', () => {
    const s = new Scheduler();
    const result = s._l2Scan('已记录，您还可以继续记账');
    assert(result !== '已记录，您还可以继续记账');
  }));

  // 44. L2 干净文本 → 不变
  promises.push(test('L2 干净文本 → 原样返回', () => {
    const s = new Scheduler();
    const result = s._l2Scan('已记录猫粮35元');
    assert(result === '已记录猫粮35元');
  }));

  // 45. Scheduler getSchedulerState 快照
  promises.push(test('getSchedulerState 返回完整快照', () => {
    const s = new Scheduler({ mode: 'detailed' });
    const snap = s.getSchedulerState();
    assert(snap.state === State.IDLE);
    assert(snap.mode === 'detailed');
    assert(snap.activeIntent === null);
    assert('tunables' in snap);
    assert('context' in snap);
  }));

  // 46. Scheduler reset
  promises.push(test('Scheduler reset 重置所有状态', () => {
    const s = new Scheduler();
    s._coldStartSessionCount = 10;
    s._antiFlapLocked = true;
    s.reset();
    assert(s.state === State.IDLE);
    assert(s._coldStartSessionCount === 0);
    assert(s._antiFlapLocked === false);
  }));

  // 47. CLARIFYING 态转发到 IN_SESSION
  promises.push(test('CLARIFYING 态输入 → 转发到 IN_SESSION', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？', askingField: 'amount' }),
    });
    await s.handleInput('小安开账');
    // 手动进入 CLARIFYING
    s._state = State.CLARIFYING;
    s._activeIntent = 'record';
    s._collectedFields = { category: '猫粮' };
    s._createSession = async () => ({ turnType: 'ask', message: '还是多少钱？' });
    const r = await s.handleInput('35');
    assert(r.state === State.IN_SESSION, `Expected IN_SESSION, got ${r.state}`);
  }));

  // 48. WAITING_CONFIRM "是" → EXECUTING → LISTENING
  promises.push(test('WAITING_CONFIRM "是" → EXECUTING → LISTENING', async () => {
    const s = new Scheduler();
    s._state = State.WAITING_CONFIRM;
    s._pendingConfirm = () => {};
    const r = await s.handleInput('是');
    assert(r.state === State.LISTENING);
  }));

  // 49. WAITING_CONFIRM "不是" → LISTENING
  promises.push(test('WAITING_CONFIRM "算了" → LISTENING', async () => {
    const s = new Scheduler();
    s._state = State.WAITING_CONFIRM;
    const r = await s.handleInput('算了');
    assert(r.state === State.LISTENING);
  }));

  // 50. WAITING_CONFIRM 非是/否 → 再次确认
  promises.push(test('WAITING_CONFIRM 模糊输入 → 再次确认', async () => {
    const s = new Scheduler();
    s._state = State.WAITING_CONFIRM;
    const r = await s.handleInput('嗯...');
    assert(r.state === State.WAITING_CONFIRM);
  }));

  // 51. intent=exit 高置信度 → CLOSING
  promises.push(test('intent=exit 高置信度 → CLOSING → IDLE', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'exit', confidence: 90, subType: null, extracted: {} }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('拜拜');
    assert(r.state === State.IDLE);
  }));

  // 52. intent=other → 回复后回 LISTENING
  promises.push(test('intent=other → 回复后回 LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'other', confidence: 90, subType: null, extracted: {} }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('你好');
    assert(r.state === State.LISTENING);
  }));

  // 53. delete intent COMPLETE → WAITING_CONFIRM
  promises.push(test('delete intent COMPLETE → WAITING_CONFIRM', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'delete', confidence: 85, subType: null, extracted: {} }),
      createSession: async () => ({ turnType: 'complete', message: '确认删除？', result: { deleted: false } }),
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('删掉午饭');
    assert(r.state === State.WAITING_CONFIRM, `Expected WAITING_CONFIRM, got ${r.state}`);
  }));

  // 54. 空输入 → 不处理
  promises.push(test('空输入 → 不处理', async () => {
    const s = new Scheduler();
    const r = await s.handleInput('');
    assert(r.state === State.IDLE);
    assert(r.reply === '');
  }));

  // 55. 空格输入 → 不处理
  promises.push(test('仅空格输入 → 不处理', async () => {
    const s = new Scheduler();
    const r = await s.handleInput('   ');
    assert(r.state === State.IDLE);
  }));

  // 56. ANALYZING 意图识别异常 → LISTENING
  promises.push(test('ANALYZING 意图识别抛异常 → LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => { throw new Error('API error'); },
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮25');
    assert(r.state === State.LISTENING);
  }));

  // 57. IN_SESSION createSession 异常 → L1 降级兜底
  promises.push(test('IN_SESSION createSession 两次异常 → 兜底 LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => { throw new Error('fail'); },
    });
    await s.handleInput('小安开账');
    const r = await s.handleInput('猫粮25');
    assert(r.state === State.LISTENING);
  }));

  // 58. _dispatchTurn 无效 turnType → LISTENING
  promises.push(test('_dispatchTurn 无效 turnType → LISTENING', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: {} }),
      createSession: async () => ({ turnType: 'invalid_type', message: '?' }),
    });
    await s.handleInput('小安开账');
    // 无效 turnType 被 validateTurn 拒绝 → 兜底
    const r = await s.handleInput('猫粮');
    assert(r.state === State.LISTENING);
  }));

  // 59. 调度器 "结束并且退出" 在所有态都生效
  promises.push(test('"结束并且退出" 在 IN_SESSION 也生效', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？' }),
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮'); // → IN_SESSION
    const r = await s.handleInput('结束并且退出');
    assert(r.state === State.IDLE);
  }));

  // 60. collectedFields 更新机制
  promises.push(test('collectedFields 在 turn 间累积更新', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async (params) => {
        if (!params.collectedFields.amount) {
          return { turnType: 'ask', message: '多少钱？', askingField: 'amount', collectedFields: { amount: null } };
        }
        return { turnType: 'complete', message: '已记录', result: { ...params.collectedFields, time: '昨天' } };
      },
      executeRecord: async () => {},
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮');
    // collectedFields should have category
    const fields = s.collectedFields;
    assert(fields.category === '猫粮', `Expected category=猫粮, got ${JSON.stringify(fields)}`);
  }));

  // 61. buildPromptContext 预算截断
  promises.push(test('buildPromptContext: 小预算限制保留轮次', () => {
    const cm = new ContextManager({ maxTurns: 20, tokenBudget: 50 });
    for (let i = 0; i < 10; i++) {
      cm.addTurn('user', `消息${i}包含一些额外文本内容来填充`);
    }
    const result = cm.buildPromptContext('最新输入', {});
    assert(result.estimatedTokens <= 50 * 0.7 + 10); // budget * ratio + tolerance
  }));

  // 62. DET 关键词扫描 record 环节
  promises.push(test('DET 关键词扫描 record 环节检测 query', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async () => ({ turnType: 'ask', message: '多少钱？' }),
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮');
    // DET 扫描 "查一下" 应该触发偏离检测
    const suspicion = s._detKeywordScan('查一下账单');
    assert(suspicion !== null);
  }));

  // 63. 多个 turn 后的上下文管理
  promises.push(test('多轮对话后 context-manager 轮次数正确', async () => {
    const s = new Scheduler({
      identifyIntent: async () => ({ intent: 'record', confidence: 85, subType: null, extracted: { category: '猫粮' } }),
      createSession: async (params) => {
        if (!params.collectedFields.amount) return { turnType: 'ask', message: '多少钱？', askingField: 'amount' };
        return { turnType: 'complete', message: '已记录', result: { category: '猫粮', amount: 35, time: '昨天' } };
      },
      executeRecord: async () => {},
    });
    await s.handleInput('小安开账');
    await s.handleInput('猫粮');
    const snap = s._contextManager.getSnapshot();
    assert(snap.totalTurns > 0);
  }));

  // ═══════════════════════════════════════════════════
  // 收尾
  // ═══════════════════════════════════════════════════

  await Promise.all(promises);

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
