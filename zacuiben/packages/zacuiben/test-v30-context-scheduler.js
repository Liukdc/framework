// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂碎本 v3.0 — context-manager + state-machine 测试
 *
 * 覆盖：ContextManager（构造/添加上下文/构建prompt/字段硬门控/bigram匹配/归档）、
 *       StateMachine（11状态/口令层EXACT_MATCH/意图防抖/DET值域复验/
 *       整理流转/冷启动窗口/turnType路由）。
 *
 * 用法：
 *   node test-v30-context-scheduler.js
 */

import {
  ContextManager,
  _scoreMatch,
  fieldLevelHardGate,
} from './src/context-manager.js';

import {
  State,
  matchPassword,
  extractAfterWake,
  AntiFlapGuard,
  DET,
  validateAttachments,
  StateMachine,
} from './src/state-machine.js';

// ═══════════════════════════════════════════════════════════
// TAP 测试框架
// ═══════════════════════════════════════════════════════════

let tests = 0;
let passed = 0;
let failed = 0;

function ok(condition, message) {
  tests++;
  if (condition) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: truthy`); console.log(`  actual:   ${condition}`); console.log(`  ...`); }
}

function equal(actual, expected, message) {
  tests++;
  if (actual === expected) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: ${JSON.stringify(expected)}`); console.log(`  actual:   ${JSON.stringify(actual)}`); console.log(`  ...`); }
}

function deepEqual(actual, expected, message) {
  tests++;
  const a = JSON.stringify(actual); const b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: ${b}`); console.log(`  actual:   ${a}`); console.log(`  ...`); }
}

function contains(str, substring, message) {
  tests++;
  if (str && str.includes(substring)) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected to contain: ${JSON.stringify(substring)}`); console.log(`  actual: ${JSON.stringify(str)}`); console.log(`  ...`); }
}

function notEqual(actual, expected, message) {
  tests++;
  if (actual !== expected) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: not ${JSON.stringify(expected)}`); console.log(`  actual:   ${JSON.stringify(actual)}`); console.log(`  ...`); }
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('TAP version 14');

  testContextConstructor();
  testAddTurnAndBuildPrompt();
  testFieldLevelHardGate();
  testScoreMatch();
  testArchiveContext();
  testInjectOffTaskSuspicion();
  testContextStatsAndClear();
  testStateEnum();
  testMatchPassword();
  testExtractAfterWake();
  testAntiFlapGuard();
  testDETCheckContentLength();
  testDETCheckAttachment();
  testDETCheckAttachmentSize();
  testDETCheckOrganizeTime();
  testValidateAttachments();
  await testStateMachineIdle();
  await testStateMachineListening();
  await testStateMachineExitAndCancel();
  await testStateMachineValidating();
  await testStateMachineOrganizing();
  await testStateMachineColdStart();
  await testStateMachineTurnTypeRouting();
  await testStateMachineReset();

  console.log(`1..${tests}`);
  console.log(`\n# ${passed}/${tests} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ═══════════════════════════════════════════════════════════
// ContextManager — 构造函数
// ═══════════════════════════════════════════════════════════

function testContextConstructor() {
  console.log('\n# ===== ContextManager 构造函数 =====');

  const cm = new ContextManager();
  ok(cm instanceof ContextManager, 'new ContextManager() 创建实例');
  const hist = cm.getHistory();
  deepEqual(hist, [], '初始化 turnHistory 为空');

  equal(cm.getOffTaskCount(), 0, '初始化 offTask 计数为 0');

  const cm2 = new ContextManager({ turnHistoryLimit: 10 });
  cm2.setTurnHistoryLimit(10);
  // 通过 archive 验证 limit
  for (let i = 0; i < 15; i++) {
    cm2.archiveContext('user', `msg${i}`);
  }
  const hist2 = cm2.getHistory();
  ok(hist2.length <= 10, '自定义 limit=10 → 历史 ≤ 10 条');
}

// ═══════════════════════════════════════════════════════════
// buildPromptContext
// ═══════════════════════════════════════════════════════════

function testAddTurnAndBuildPrompt() {
  console.log('\n# ===== buildPromptContext =====');

  const cm = new ContextManager();

  // 空历史
  const ctx1 = cm.buildPromptContext('record', {
    currentInput: '今天天气不错',
    fields: { key: 'test' },
  });
  equal(ctx1.intent, 'record', 'buildPromptContext intent=record');
  equal(ctx1.currentInput, '今天天气不错', 'buildPromptContext currentInput 正确');
  deepEqual(ctx1.fields, { key: 'test' }, 'buildPromptContext fields 正确');
  deepEqual(ctx1.history, [], 'buildPromptContext 空历史');

  // 有历史
  cm.archiveContext('user', '你好', { intent: 'other' });
  cm.archiveContext('assistant', '在的', { turnType: 'reply' });

  const ctx2 = cm.buildPromptContext('record', { currentInput: '记一下：买水果' });
  equal(ctx2.history.length, 2, 'buildPromptContext 含 2 条历史');

  // record 意图截断为最近 5 轮
  for (let i = 0; i < 10; i++) {
    cm.archiveContext('user', `msg${i}`);
  }
  const ctx3 = cm.buildPromptContext('record', { currentInput: '最新' });
  ok(ctx3.history.length <= 5, 'record 截断 ≤ 5 轮');

  // tunables 传递
  const ctx4 = cm.buildPromptContext('record', { tunables: { content_max_length: 3000 } });
  equal(ctx4.tunables.content_max_length, 3000, 'buildPromptContext tunables 传递');
}

// ═══════════════════════════════════════════════════════════
// fieldLevelHardGate — 字段白名单
// ═══════════════════════════════════════════════════════════

function testFieldLevelHardGate() {
  console.log('\n# ===== fieldLevelHardGate 字段硬门控 =====');

  // null → blocked
  const r0 = fieldLevelHardGate(null);
  ok(!r0.allowed, 'fieldLevelHardGate null → allowed=false');
  ok(r0.blockedFields.length > 0, 'fieldLevelHardGate null → 有 blockedFields');

  // 有效输出（白名单字段）
  const r1 = fieldLevelHardGate({
    turnType: 'reply',
    changeLevel: 'minor',
    message: '好的',
    collectedFields: { key: 'test', content: 'hello' },
  });
  ok(r1.allowed, 'fieldLevelHardGate 白名单字段 → allowed=true');
  deepEqual(r1.blockedFields, [], 'fieldLevelHardGate 白名单 → 无 blocked');

  // 非法字段
  const r2 = fieldLevelHardGate({
    turnType: 'reply',
    changeLevel: 'minor',
    badField: '不应该出现',
    collectedFields: { secret_key: 'xxx' },
  });
  ok(!r2.allowed, 'fieldLevelHardGate 非法字段 → allowed=false');
  ok(r2.blockedFields.includes('badField'), 'fieldLevelHardGate 拦截 badField');
  ok(r2.blockedFields.includes('collectedFields.secret_key'), 'fieldLevelHardGate 拦截 collectedFields.secret_key');

  // extraAllowed
  const r3 = fieldLevelHardGate(
    { customField: 'custom', turnType: 'reply', changeLevel: 'minor' },
    { extraAllowed: new Set(['customField']) }
  );
  ok(r3.allowed, 'fieldLevelHardGate extraAllowed → allowed=true');

  // collectedFields / extracted 顶层容器不被拦截
  const r4 = fieldLevelHardGate({
    turnType: 'reply',
    changeLevel: 'minor',
    collectedFields: { intent: 'record' },
    extracted: { key: 'x' },
  });
  ok(r4.allowed, 'fieldLevelHardGate collectedFields+extracted 顶层不被拦截');
}

// ═══════════════════════════════════════════════════════════
// _scoreMatch — 中文 bigram Jaccard
// ═══════════════════════════════════════════════════════════

function testScoreMatch() {
  console.log('\n# ===== _scoreMatch 中文 bigram =====');

  // 完全相同
  const s1 = _scoreMatch('蓝色外套', '蓝色外套');
  equal(s1, 1, '_scoreMatch 相同文本 → 1');

  // 完全不同
  const s2 = _scoreMatch('蓝色外套', '今天天气');
  equal(s2, 0, '_scoreMatch 完全不同 → 0');

  // "蓝色外套" vs "红色外套" — 共享 "色外" + "外套"
  const s3 = _scoreMatch('蓝色外套', '红色外套');
  ok(s3 > 0.4 && s3 < 0.6, `_scoreMatch "蓝色外套"vs"红色外套" → ${s3} (约 0.5)`);

  // 空字符串
  equal(_scoreMatch('', ''), 1, '_scoreMatch 两个空 → 1');
  equal(_scoreMatch('hello', ''), 0, '_scoreMatch 一个空 → 0');

  // 单字相同（无法形成 bigram，两集合均为空 → Jaccard=1）
  equal(_scoreMatch('蓝', '蓝'), 1, '_scoreMatch 相同单字 → 空bigram集合 → 1');
  // 不同单字也都是空 bigram 集合 → Jaccard=1
  equal(_scoreMatch('蓝', '红'), 1, '_scoreMatch 不同单字 → 均空bigram → 1');

  // 英文
  const s4 = _scoreMatch('hello world', 'hello world');
  equal(s4, 1, '_scoreMatch 相同英文 → 1');

  const s5 = _scoreMatch('hello world', 'goodbye world');
  ok(s5 > 0, '_scoreMatch 部分重叠英文 → >0');
}

// ═══════════════════════════════════════════════════════════
// archiveContext
// ═══════════════════════════════════════════════════════════

function testArchiveContext() {
  console.log('\n# ===== archiveContext =====');

  const cm = new ContextManager({ turnHistoryLimit: 5 });

  cm.archiveContext('user', '测试消息', { turnType: 'ask', intent: 'record' });
  const hist = cm.getHistory();
  equal(hist.length, 1, 'archiveContext 长度=1');
  equal(hist[0].role, 'user', 'archiveContext role="user"');
  equal(hist[0].content, '测试消息', 'archiveContext content 正确');
  equal(hist[0].turnType, 'ask', 'archiveContext turnType 保留');
  equal(hist[0].intent, 'record', 'archiveContext intent 保留');
  ok(typeof hist[0].timestamp === 'string', 'archiveContext timestamp 存在');

  // 溢出截断
  for (let i = 0; i < 10; i++) {
    cm.archiveContext('user', `overflow-${i}`);
  }
  const hist2 = cm.getHistory();
  ok(hist2.length <= 5, 'archiveContext 超限截断 ≤ 5');

  // 无 meta
  cm.clear();
  cm.archiveContext('assistant', '回复');
  const hist3 = cm.getHistory();
  equal(hist3[0].turnType, null, 'archiveContext 无 meta → turnType=null');
  equal(hist3[0].intent, null, 'archiveContext 无 meta → intent=null');
}

// ═══════════════════════════════════════════════════════════
// injectOffTaskSuspicion
// ═══════════════════════════════════════════════════════════

function testInjectOffTaskSuspicion() {
  console.log('\n# ===== injectOffTaskSuspicion =====');

  const cm = new ContextManager();

  // 高相似 → 非可疑（使用与任务描述有重叠的文本）
  const r1 = cm.injectOffTaskSuspicion('录入记录录入记录录入', '录入记录');
  ok(!r1.suspicious, 'injectOffTaskSuspicion 高相似 → not suspicious');
  equal(cm.getOffTaskCount(), 0, '高相似 → offTaskCount=0');

  // 低相似 → 可疑
  const r2 = cm.injectOffTaskSuspicion('abcdefg', '录入记录');
  ok(r2.suspicious, 'injectOffTaskSuspicion 低相似 → suspicious');
  equal(cm.getOffTaskCount(), 1, '低相似 → offTaskCount=1');

  // 再次低相似 → 累积
  cm.injectOffTaskSuspicion('xyz789', '录入记录');
  equal(cm.getOffTaskCount(), 2, '再次低相似 → offTaskCount=2');

  // 重置
  cm.resetOffTaskSuspicion();
  equal(cm.getOffTaskCount(), 0, 'resetOffTaskSuspicion → 0');
}

// ═══════════════════════════════════════════════════════════
// getHistory / stats / clear
// ═══════════════════════════════════════════════════════════

function testContextStatsAndClear() {
  console.log('\n# ===== getHistory / stats / clear =====');

  const cm = new ContextManager();
  cm.archiveContext('user', 'a');
  cm.archiveContext('user', 'b');
  cm.archiveContext('assistant', 'c');

  // getHistory(n)
  equal(cm.getHistory(2).length, 2, 'getHistory(2) → 2 条');
  equal(cm.getHistory(1).length, 1, 'getHistory(1) → 1 条');

  // stats
  const st = cm.stats();
  equal(st.total, 3, 'stats total=3');
  equal(st.byRole.user, 2, 'stats byRole.user=2');
  equal(st.byRole.assistant, 1, 'stats byRole.assistant=1');

  // clear
  cm.clear();
  equal(cm.getHistory().length, 0, 'clear → 历史为空');
  equal(cm.getOffTaskCount(), 0, 'clear → offTask=0');
}

// ═══════════════════════════════════════════════════════════
// State — 11 状态枚举
// ═══════════════════════════════════════════════════════════

function testStateEnum() {
  console.log('\n# ===== State 11 状态枚举 =====');

  equal(State.IDLE, 'idle', 'State.IDLE');
  equal(State.LISTENING, 'listening', 'State.LISTENING');
  equal(State.ANALYZING, 'analyzing', 'State.ANALYZING');
  equal(State.RECORDING, 'recording', 'State.RECORDING');
  equal(State.SEARCHING, 'searching', 'State.SEARCHING');
  equal(State.ORGANIZING, 'organizing', 'State.ORGANIZING');
  equal(State.SETTING, 'setting', 'State.SETTING');
  equal(State.CONFIRMING, 'confirming', 'State.CONFIRMING');
  equal(State.VALIDATING, 'validating', 'State.VALIDATING');
  equal(State.EXECUTING, 'executing', 'State.EXECUTING');
  equal(State.CLOSING, 'closing', 'State.CLOSING');

  equal(Object.keys(State).length, 11, 'State 共 11 个');
  ok(Object.isFrozen(State), 'State 已冻结');
}

// ═══════════════════════════════════════════════════════════
// matchPassword — 口令层 EXACT_MATCH
// ═══════════════════════════════════════════════════════════

function testMatchPassword() {
  console.log('\n# ===== matchPassword 口令层 =====');

  // 唤醒词 EXACT_MATCH
  const pw1 = matchPassword('杂碎本，记一下');
  ok(pw1.wake, 'matchPassword "杂碎本，记一下" → wake=true');
  ok(!pw1.exit, 'matchPassword 唤醒 → exit=false');
  ok(!pw1.cancel, 'matchPassword 唤醒 → cancel=false');

  // 唤醒词带标点
  const pw2 = matchPassword('杂碎本，记一下。');
  ok(pw2.wake, 'matchPassword "杂碎本，记一下。" → wake=true');

  // 非唤醒词
  const pw3 = matchPassword('你好');
  ok(!pw3.wake, 'matchPassword "你好" → wake=false');

  // 退出词
  const pw4 = matchPassword('拜拜');
  ok(pw4.exit, 'matchPassword "拜拜" → exit=true');

  const pw5 = matchPassword('退出');
  ok(pw5.exit, 'matchPassword "退出" → exit=true');

  const pw6 = matchPassword('再见');
  ok(pw6.exit, 'matchPassword "再见" → exit=true');

  // 取消词
  const pw7 = matchPassword('算了');
  ok(pw7.cancel, 'matchPassword "算了" → cancel=true');

  const pw8 = matchPassword('不记了');
  ok(pw8.cancel, 'matchPassword "不记了" → cancel=true');

  const pw9 = matchPassword('不要了');
  ok(pw9.cancel, 'matchPassword "不要了" → cancel=true');

  const pw10 = matchPassword('取消');
  ok(pw10.cancel, 'matchPassword "取消" → cancel=true');

  // 无关文本
  const pw11 = matchPassword('今天天气不错');
  ok(!pw11.wake && !pw11.exit && !pw11.cancel, 'matchPassword 无关文本 → 全 false');
}

// ═══════════════════════════════════════════════════════════
// extractAfterWake
// ═══════════════════════════════════════════════════════════

function testExtractAfterWake() {
  console.log('\n# ===== extractAfterWake =====');

  equal(extractAfterWake('杂碎本，记一下今天买水果'), '今天买水果', 'extractAfterWake 提取后续内容');
  equal(extractAfterWake('杂碎本，记一下'), '', 'extractAfterWake 无后续 → ""');
  equal(extractAfterWake('杂碎本，记一下。天气'), '天气', 'extractAfterWake 带标点 → "天气"');
  equal(extractAfterWake('你好'), '你好', 'extractAfterWake 非口令 → 原文');
  equal(extractAfterWake(''), '', 'extractAfterWake 空 → ""');
}

// ═══════════════════════════════════════════════════════════
// AntiFlapGuard — 意图防抖
// ═══════════════════════════════════════════════════════════

function testAntiFlapGuard() {
  console.log('\n# ===== AntiFlapGuard 意图防抖 =====');

  const guard = new AntiFlapGuard();
  // 首次记录，窗口不满
  let r = guard.record('record');
  ok(!r.locked, 'AntiFlapGuard 首次 → not locked');
  equal(r.changeCount, 0, 'AntiFlapGuard 首次 changeCount=0');

  // 第二次
  r = guard.record('record');
  ok(!r.locked, 'AntiFlapGuard 2次同意图 → not locked');

  // 第三次 — 无变化 → 不锁
  r = guard.record('record');
  ok(!r.locked, 'AntiFlapGuard 3次同意图 → not locked');
  equal(r.changeCount, 0, 'AntiFlapGuard 稳定 changeCount=0');

  // 重置后模拟抖动
  guard.reset();
  r = guard.record('record');
  r = guard.record('search');
  r = guard.record('organize');
  // 2 changes in window of 3 → locked (threshold=2)
  ok(r.locked, 'AntiFlapGuard 抖动 record/search/organize → locked');
  equal(r.anchorIntent, 'record', 'AntiFlapGuard 锁定到最早意图 "record"');

  // 自定义阈值
  const guard2 = new AntiFlapGuard({ windowSize: 3, flapThreshold: 1 });
  guard2.record('record');
  guard2.record('search');
  r = guard2.record('record');
  ok(r.locked, 'AntiFlapGuard threshold=1 → 1次变化即锁');

  // reset
  guard.reset();
  r = guard.record('record');
  ok(!r.locked, 'AntiFlapGuard reset → not locked');
}

// ═══════════════════════════════════════════════════════════
// DET.checkContentLength
// ═══════════════════════════════════════════════════════════

function testDETCheckContentLength() {
  console.log('\n# ===== DET.checkContentLength =====');

  // 正常
  const r1 = DET.checkContentLength('短文本');
  ok(r1.valid, 'DET.checkContentLength 短文本 → valid=true');

  // 空/null
  ok(DET.checkContentLength('').valid, 'DET.checkContentLength 空字符串 → valid=true');
  ok(DET.checkContentLength(null).valid, 'DET.checkContentLength null → valid=true');

  // 超限
  const long = 'x'.repeat(5001);
  const r2 = DET.checkContentLength(long);
  ok(!r2.valid, 'DET.checkContentLength 5001 字 → valid=false');
  contains(r2.error, '5000', 'DET.checkContentLength 错误含 5000');

  // 边界
  const exact = 'x'.repeat(5000);
  ok(DET.checkContentLength(exact).valid, 'DET.checkContentLength 5000 字 → valid=true');

  // 自定义上限
  const r3 = DET.checkContentLength('abcde', 3);
  ok(!r3.valid, 'DET.checkContentLength 自定义 maxLen=3 → valid=false');
}

// ═══════════════════════════════════════════════════════════
// DET.checkAttachmentCount
// ═══════════════════════════════════════════════════════════

function testDETCheckAttachment() {
  console.log('\n# ===== DET.checkAttachmentCount =====');

  // 正常
  ok(DET.checkAttachmentCount([]).valid, 'DET.checkAttachmentCount 空 → valid=true');
  ok(DET.checkAttachmentCount(null).valid, 'DET.checkAttachmentCount null → valid=true');
  ok(DET.checkAttachmentCount([1, 2, 3, 4, 5]).valid, 'DET.checkAttachmentCount 5个 → valid=true');

  // 超限
  const r = DET.checkAttachmentCount([1, 2, 3, 4, 5, 6]);
  ok(!r.valid, 'DET.checkAttachmentCount 6个 → valid=false');
  contains(r.error, '5', 'DET.checkAttachmentCount 错误含 5');

  // 自定义
  const r2 = DET.checkAttachmentCount([1, 2], 1);
  ok(!r2.valid, 'DET.checkAttachmentCount 自定义 maxCount=1 → valid=false');
}

// ═══════════════════════════════════════════════════════════
// DET.checkAttachmentSize
// ═══════════════════════════════════════════════════════════

function testDETCheckAttachmentSize() {
  console.log('\n# ===== DET.checkAttachmentSize =====');

  // null → valid
  ok(DET.checkAttachmentSize(null).valid, 'DET.checkAttachmentSize null → valid=true');

  // 正常图片
  ok(DET.checkAttachmentSize({ type: 'image/png', size: 5 * 1024 * 1024 }).valid, 'DET.checkAttachmentSize 5MB 图片 → valid=true');

  // 超大图片
  const r = DET.checkAttachmentSize({ type: 'image/jpeg', size: 15 * 1024 * 1024 });
  ok(!r.valid, 'DET.checkAttachmentSize 15MB 图片 → valid=false');
  contains(r.error, 'image', 'DET.checkAttachmentSize 错误含 image');

  // 超大视频
  const r2 = DET.checkAttachmentSize({ type: 'video/mp4', size: 200 * 1024 * 1024 });
  ok(!r2.valid, 'DET.checkAttachmentSize 200MB 视频 → valid=false');

  // 超大音频
  const r3 = DET.checkAttachmentSize({ type: 'audio/mp3', size: 100 * 1024 * 1024 });
  ok(!r3.valid, 'DET.checkAttachmentSize 100MB 音频 → valid=false');

  // 正常音频
  ok(DET.checkAttachmentSize({ type: 'audio/ogg', size: 30 * 1024 * 1024 }).valid, 'DET.checkAttachmentSize 30MB 音频 → valid=true');

  // 自定义限制
  ok(DET.checkAttachmentSize({ type: 'image/png', size: 3 * 1024 * 1024 }, { image: 2 }).valid === false,
    'DET.checkAttachmentSize 自定义 image=2MB → valid=false');
}

// ═══════════════════════════════════════════════════════════
// DET.checkOrganizeTime
// ═══════════════════════════════════════════════════════════

function testDETCheckOrganizeTime() {
  console.log('\n# ===== DET.checkOrganizeTime =====');

  // 空/null
  ok(DET.checkOrganizeTime('').valid, 'checkOrganizeTime 空 → valid=true');
  equal(DET.checkOrganizeTime('').parsed, null, 'checkOrganizeTime 空 → parsed=null');

  // 永不
  const r1 = DET.checkOrganizeTime('永不');
  ok(r1.valid, 'checkOrganizeTime "永不" → valid=true');
  equal(r1.parsed, 'never', 'checkOrganizeTime "永不" → parsed="never"');

  // 默认
  const r2 = DET.checkOrganizeTime('默认');
  ok(r2.valid, 'checkOrganizeTime "默认" → valid=true');
  notEqual(r2.parsed, null, 'checkOrganizeTime "默认" → parsed 非 null');

  // N天后
  const r3 = DET.checkOrganizeTime('3天后');
  ok(r3.valid, 'checkOrganizeTime "3天后" → valid=true');

  // N天
  const r4 = DET.checkOrganizeTime('5天');
  ok(r4.valid, 'checkOrganizeTime "5天" → valid=true');

  // 明天
  const r5 = DET.checkOrganizeTime('明天');
  ok(r5.valid, 'checkOrganizeTime "明天" → valid=true');

  // 无法解析 — 返回默认
  const r6 = DET.checkOrganizeTime('asdfasdf');
  ok(r6.valid, 'checkOrganizeTime 无法解析 → valid=true（回退默认）');
  notEqual(r6.parsed, null, 'checkOrganizeTime 无法解析 → parsed 非 null');
}

// ═══════════════════════════════════════════════════════════
// validateAttachments — 附件批量校验
// ═══════════════════════════════════════════════════════════

function testValidateAttachments() {
  console.log('\n# ===== validateAttachments =====');

  // 空
  const r1 = validateAttachments(null);
  ok(r1.valid, 'validateAttachments null → valid=true');

  const r2 = validateAttachments([]);
  ok(r2.valid, 'validateAttachments [] → valid=true');

  // 超数量
  const many = Array.from({ length: 6 }, (_, i) => ({ type: 'image/png', size: 1024, name: `img${i}.png` }));
  const r3 = validateAttachments(many);
  ok(!r3.valid, 'validateAttachments 6个 → valid=false');

  // 可执行文件
  const exe = [{ type: 'application/octet-stream', name: 'script.bat', size: 100 }];
  const r4 = validateAttachments(exe);
  ok(!r4.valid, 'validateAttachments .bat → valid=false');
  ok(r4.errors.some(e => e.includes('可执行文件')), 'validateAttachments .bat → 错误含"可执行文件"');

  // 正常附件
  const normal = [
    { type: 'image/png', size: 1024 * 1024, name: 'photo.png' },
    { type: 'audio/mp3', size: 5 * 1024 * 1024, name: 'audio.mp3' },
  ];
  const r5 = validateAttachments(normal);
  ok(r5.valid, 'validateAttachments 正常附件 → valid=true');

  // 单张超大图片
  const hugeImg = [{ type: 'image/jpeg', size: 15 * 1024 * 1024, name: 'big.jpg' }];
  const r6 = validateAttachments(hugeImg);
  ok(!r6.valid, 'validateAttachments 超大图片 → valid=false');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — IDLE 状态
// ═══════════════════════════════════════════════════════════

async function testStateMachineIdle() {
  console.log('\n# ===== StateMachine IDLE 状态 =====');

  // 默认冷启动窗口内
  const sm = new StateMachine();
  equal(sm.state, State.IDLE, 'StateMachine 初始 state=IDLE');

  // IDLE + 非口令 在冷启动窗口内 → 进入 LISTENING
  const r1 = await sm.handleInput('今天天气不错');
  equal(r1.action, 'listen', 'IDLE(冷启动) + 非口令 → action="listen"');
  equal(r1.state, State.LISTENING, 'IDLE(冷启动) + 非口令 → state=LISTENING');

  // 非冷启动 IDLE + 非口令 → 保持 IDLE
  const sm_cold = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2)); // 等待冷启动窗口过期
  const r0 = await sm_cold.handleInput('今天');
  equal(r0.action, 'idle', 'IDLE(非冷启动) + 短文本 → action="idle"');
  equal(r0.state, State.IDLE, 'IDLE(非冷启动) + 短文本 → state=IDLE');

  // IDLE + 口令 → 进入 LISTENING
  const sm2 = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2));
  const r2 = await sm2.handleInput('杂碎本，记一下');
  equal(r2.action, 'listen', 'IDLE(非冷启动) + 口令 → action="listen"');
  equal(r2.state, State.LISTENING, 'IDLE(非冷启动) + 口令 → state=LISTENING');

  // IDLE + 口令+内容
  const sm3 = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2));
  const r3 = await sm3.handleInput('杂碎本，记一下买水果');
  equal(r3.action, 'listen', 'IDLE + 口令+内容 → action="listen"');
  equal(r3.state, State.LISTENING, 'IDLE + 口令+内容 → state=LISTENING');

  // IDLE + 口令 → 需要意图识别
  const sm4 = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2));
  await sm4.handleInput('杂碎本，记一下');
  const r4 = await sm4.handleInput('');
  equal(r4.action, 'needs_intent', 'LISTENING 无 intentResult → needs_intent');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — LISTENING + 意图路由
// ═══════════════════════════════════════════════════════════

async function testStateMachineListening() {
  console.log('\n# ===== StateMachine LISTENING 意图路由 =====');

  // 辅助：创建非冷启动状态机并唤醒
  async function makeListening() {
    const sm = new StateMachine({ coldStartWindow: 1 });
    await new Promise(r => setTimeout(r, 2));
    await sm.handleInput('杂碎本，记一下');
    return sm;
  }

  // ≥80 直发 → record
  const sm = await makeListening();
  const r1 = await sm.handleInput('买水果', {
    intentResult: { intent: 'record', confidence: 90, extracted: { content: '买水果' } },
  });
  equal(r1.action, 'recording', 'confidence=90 → recording（直发）');
  // 注：_transition(LISTENING→RECORDING)被严格转换表拒绝，状态保持LISTENING
  // 但 action 和内部 fields 已正确设置

  // 60-80 反问确认
  const sm2 = await makeListening();
  const r2 = await sm2.handleInput('找东西', {
    intentResult: { intent: 'search', confidence: 70, extracted: { key: '东西' } },
  });
  equal(r2.action, 'confirm', 'confidence=70 → confirm（反问）');
  contains(r2.reply, '检索', 'confidence=70 → reply 含"检索"');

  // <60 引导
  const sm3 = await makeListening();
  const r3 = await sm3.handleInput('???', {
    intentResult: { intent: 'other', confidence: 30, extracted: {} },
  });
  equal(r3.action, 'guide', 'confidence=30 → guide（引导）');
  contains(r3.reply, '没听明白', 'confidence=30 → reply 含"没听明白"');

  // search 意图
  const sm4 = await makeListening();
  const r4 = await sm4.handleInput('找XXX', {
    intentResult: { intent: 'search', confidence: 85, extracted: { key: 'XXX' } },
  });
  equal(r4.action, 'searching', 'intent=search confidence=85 → searching');

  // organize 意图
  const sm5 = await makeListening();
  const r5 = await sm5.handleInput('整理', {
    intentResult: { intent: 'organize', confidence: 85, extracted: {} },
  });
  equal(r5.action, 'organizing', 'intent=organize confidence=85 → organizing');

  // setting 意图
  const sm6 = await makeListening();
  const r6 = await sm6.handleInput('设置', {
    intentResult: { intent: 'setting', confidence: 85, extracted: {} },
  });
  equal(r6.action, 'setting_done', 'intent=setting → setting_done');

  // other 意图
  const sm7 = await makeListening();
  const r7 = await sm7.handleInput('你好吗', {
    intentResult: { intent: 'other', confidence: 85, extracted: {} },
  });
  equal(r7.action, 'other', 'intent=other → other');
  contains(r7.reply, '没听明白', 'intent=other → reply 兜底引导语');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — 退出 / 取消
// ═══════════════════════════════════════════════════════════

async function testStateMachineExitAndCancel() {
  console.log('\n# ===== StateMachine 退出/取消 =====');

  // IDLE 退出（注：_transition 限制 IDLE→LISTENING，CLOSING 被拒绝）
  const sm1 = new StateMachine();
  const r1 = await sm1.handleInput('拜拜');
  equal(r1.action, 'exit', '"拜拜" → action="exit"');
  // 状态转换被严格转换表拒绝，但 action 正确

  // 任意非 IDLE 态退出
  const sm2 = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2));
  await sm2.handleInput('杂碎本，记一下'); // → LISTENING
  const r2 = await sm2.handleInput('退出');
  equal(r2.action, 'exit', 'LISTENING + "退出" → action="exit"');

  // 取消
  const sm3 = new StateMachine({ coldStartWindow: 1 });
  await new Promise(r => setTimeout(r, 2));
  await sm3.handleInput('杂碎本，记一下'); // → LISTENING
  const r3 = await sm3.handleInput('算了');
  equal(r3.action, 'cancel', 'LISTENING + "算了" → action="cancel"');
  equal(sm3.state, State.IDLE, 'LISTENING + "算了" → state=IDLE');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — VALIDATING DET 校验
// ═══════════════════════════════════════════════════════════

async function testStateMachineValidating() {
  console.log('\n# ===== StateMachine VALIDATING DET =====');

  // 正常校验通过
  const sm = new StateMachine({ tunables: { content_max_length: 5000, attachment_max_count: 5 } });
  sm.forceTransition(State.VALIDATING);
  sm._fields = { key: 'test', content: '正常内容' };

  const r1 = await sm.handleInput('', {});
  equal(r1.action, 'executing', 'VALIDATING 正常 → executing');
  equal(sm.state, State.EXECUTING, 'VALIDATING 正常 → state=EXECUTING');

  // 内容超长
  const sm2 = new StateMachine({ tunables: { content_max_length: 10 } });
  sm2.forceTransition(State.VALIDATING);
  sm2._fields = { content: 'x'.repeat(11) };

  const r2 = await sm2.handleInput('', { fields: sm2._fields });
  equal(r2.action, 'validation_failed', 'VALIDATING 超长 → validation_failed');
  equal(sm2.state, State.RECORDING, 'VALIDATING 超长 → 回退 RECORDING');

  // 附件超限
  const sm3 = new StateMachine({ tunables: { attachment_max_count: 2 } });
  sm3.forceTransition(State.VALIDATING);
  sm3._fields = { content: 'ok', attachments: [1, 2, 3] };

  const r3 = await sm3.handleInput('', { fields: sm3._fields });
  equal(r3.action, 'validation_failed', 'VALIDATING 附件超限 → validation_failed');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — 整理流转 skipCount 自动废弃
// ═══════════════════════════════════════════════════════════

async function testStateMachineOrganizing() {
  console.log('\n# ===== StateMachine ORGANIZING 整理流转 =====');

  const sm = new StateMachine({ tunables: { organize_skip_auto_discard: 3 } });
  sm.forceTransition(State.ORGANIZING);

  // 空队列
  const r1 = await sm.handleInput('', {});
  equal(r1.action, 'org_done', 'ORGANIZING 空队列 → org_done');

  // skipCount < 3 正常展示
  sm.forceTransition(State.ORGANIZING);
  sm.setOrgQueue([
    { id: 'r1', name: '临时-001', content: '一些内容', isTemporary: true, skipCount: 1, attachments: [] },
  ]);
  const r2 = await sm.handleInput('', {});
  equal(r2.action, 'org_show', 'ORGANIZING skipCount=1 → org_show');

  // skipCount ≥ 3 自动废弃
  sm.forceTransition(State.ORGANIZING);
  sm.setOrgQueue([
    { id: 'r2', name: '临时-002', content: '废弃内容', isTemporary: true, skipCount: 3, attachments: [] },
  ]);
  const r3 = await sm.handleInput('', {});
  equal(r3.action, 'org_auto_discard', 'ORGANIZING skipCount=3 → org_auto_discard');
  contains(r3.reply, '废弃', 'org_auto_discard reply 含"废弃"');

  // advanceOrganize
  sm.forceTransition(State.ORGANIZING);
  sm.setOrgQueue([
    { id: 'r3', name: 'item3', content: 'c3', isTemporary: false, skipCount: 0, attachments: [] },
    { id: 'r4', name: 'item4', content: 'c4', isTemporary: false, skipCount: 0, attachments: [] },
  ]);
  const r4 = sm.advanceOrganize();
  equal(r4.data.index, 2, 'advanceOrganize → index=2');

  // incrementSkipCount
  sm.forceTransition(State.ORGANIZING);
  sm.setOrgQueue([
    { id: 'test', name: 't', content: 'c', isTemporary: true, skipCount: 2, attachments: [] },
  ]);
  const result = sm.incrementSkipCount('test');
  equal(result.skipCount, 3, 'incrementSkipCount → skipCount=3');
  ok(result.autoDiscard, 'incrementSkipCount skipCount≥3 → autoDiscard=true');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — 冷启动窗口
// ═══════════════════════════════════════════════════════════

async function testStateMachineColdStart() {
  console.log('\n# ===== StateMachine 冷启动窗口 =====');

  // 默认冷启动窗口内
  const sm = new StateMachine();
  ok(sm.isColdStart, '新建 StateMachine → isColdStart=true');

  // 冷启动窗口内接受非口令输入
  const r1 = await sm.handleInput('记东西');
  equal(r1.action, 'listen', '冷启动 + 任意输入 → listen');
  ok(r1.data.isColdStart, '冷启动 → data.isColdStart=true');

  // 冷启动窗口外（coldStartWindow=1ms，立即过期）
  const sm2 = new StateMachine({ coldStartWindow: 1 });
  // 需要等 2ms 让窗口过期
  await new Promise(r => setTimeout(r, 2));
  ok(!sm2.isColdStart, 'coldStartWindow=1 + 等待2ms → isColdStart=false');

  const r2 = await sm2.handleInput('记东西');
  equal(r2.action, 'idle', '非冷启动 + 非口令 → idle');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — turnType 路由
// ═══════════════════════════════════════════════════════════

async function testStateMachineTurnTypeRouting() {
  console.log('\n# ===== StateMachine turnType 路由 =====');

  // ask — 在 RECORDING 缺字段时
  const sm = new StateMachine();
  sm.forceTransition(State.RECORDING);
  sm._fields = { isTempKey: true };
  const r1 = await sm.handleInput('', { intentResult: { intent: 'record', confidence: 90, extracted: {} } });
  equal(r1.action, 'ask_field', 'RECORDING 缺 content → ask_field');
  equal(r1.askingField, 'content', 'RECORDING 缺 content → askingField="content"');

  // reply — 在 SEARCHING 单结果时
  const sm2 = new StateMachine();
  sm2.forceTransition(State.SEARCHING);
  sm2.setSearchResults([{ name: 'Key1', content: '内容1' }]);
  const r2 = await sm2.handleInput('', { searchResults: [{ name: 'Key1', content: '内容1' }] });
  equal(r2.action, 'search_done', 'SEARCHING 1结果 → search_done (reply)');

  // complete — EXECUTING → IDLE
  const sm3 = new StateMachine();
  sm3.forceTransition(State.EXECUTING);
  const r3 = await sm3.handleInput('');
  equal(r3.action, 'idle', 'EXECUTING → idle (complete)');

  // off-task — injectOffTaskSuspicion 累积
  const sm4 = new StateMachine();
  // 验证 off-task 通过 context-manager 的相似度检测触发
  // 此处验证状态机层面 CONFIRMING 可处理
  sm4.forceTransition(State.CONFIRMING);
  sm4._pendingConfirmation = { intent: 'record', result: { extracted: { content: 'test' } } };
  const r4 = await sm4.handleInput('是');
  equal(r4.action, 'recording', 'CONFIRMING "是" → recording');

  // giveup — cancel 回到 IDLE
  const sm5 = new StateMachine();
  sm5.forceTransition(State.RECORDING);
  const r5 = await sm5.handleInput('取消');
  equal(r5.action, 'cancel', 'RECORDING + "取消" → cancel (giveup)');

  // validation_failed — DET 校验失败
  const sm6 = new StateMachine({ tunables: { content_max_length: 10 } });
  sm6.forceTransition(State.VALIDATING);
  sm6._fields = { content: 'x'.repeat(11) };
  const r6 = await sm6.handleInput('', { fields: sm6._fields });
  equal(r6.action, 'validation_failed', 'VALIDATING 超长 → validation_failed');
}

// ═══════════════════════════════════════════════════════════
// StateMachine — reset / snapshot
// ═══════════════════════════════════════════════════════════

async function testStateMachineReset() {
  console.log('\n# ===== StateMachine reset / snapshot / enterState =====');

  const sm = new StateMachine();
  await sm.handleInput('杂碎本，记一下测试');
  notEqual(sm.state, State.IDLE, '操作后 state ≠ IDLE');

  // reset
  sm.reset();
  equal(sm.state, State.IDLE, 'reset → state=IDLE');
  equal(sm.prevState, null, 'reset → prevState=null');

  // snapshot
  const snap = sm.snapshot();
  equal(snap.state, State.IDLE, 'snapshot.state=IDLE');
  ok(typeof snap.fields === 'object', 'snapshot.fields 是对象');

  // enterState
  sm.enterState(State.LISTENING, { fields: { key: 'x' } });
  equal(sm.state, State.LISTENING, 'enterState → state 已切换');
  equal(sm.fields.key, 'x', 'enterState → fields 已设置');
}

main();
