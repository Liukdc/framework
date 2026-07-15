// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂碎本 v3.0 — turnType + tunables 测试
 *
 * 覆盖：TurnType/AskingField/ChangeLevel 枚举、validateTurn、createTurn、
 *       getTunable/setTunable/detectConflicts。
 *
 * 用法：
 *   node test-v30-turnType-tunables.js
 */

import {
  TurnType, AskingField, ChangeLevel,
  changeLevelDefaults,
  validateTurn, createTurn, createValidationFailed,
  isValidChangeLevel, isValidTurnType,
} from './src/turnType.js';

import {
  getTunable, setTunable, detectConflicts,
  getAllParamDefs, getParamDef, createDefaultState, isValidTunableName,
} from './src/tunables.js';

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

function notEqual(actual, expected, message) {
  tests++;
  if (actual !== expected) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: not ${JSON.stringify(expected)}`); console.log(`  actual:   ${JSON.stringify(actual)}`); console.log(`  ...`); }
}

function throws(fn, message) {
  tests++;
  try { fn(); failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: function to throw`); console.log(`  ...`); }
  catch (e) { passed++; console.log(`ok ${tests} - ${message}`); }
}

function contains(str, substring, message) {
  tests++;
  if (str && str.includes(substring)) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected to contain: ${JSON.stringify(substring)}`); console.log(`  actual: ${JSON.stringify(str)}`); console.log(`  ...`); }
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

function main() {
  console.log('TAP version 14');

  testTurnTypeEnum();
  testAskingFieldEnum();
  testChangeLevelEnum();
  testChangeLevelDefaults();
  testValidateTurn();
  testCreateTurn();
  testCreateValidationFailed();
  testIsValidHelpers();
  testGetTunableDefaults();
  testGetTunableCustom();
  testGetTunableUnknown();
  testSetTunable();
  testDetectConflicts();
  testCreateDefaultState();
  testParamDefs();

  console.log(`1..${tests}`);
  console.log(`\n# ${passed}/${tests} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ═══════════════════════════════════════════════════════════
// TurnType 枚举 (6 值)
// ═══════════════════════════════════════════════════════════

function testTurnTypeEnum() {
  console.log('\n# ===== TurnType 六值枚举 =====');

  equal(TurnType.ASK, 'ask', 'TurnType.ASK === "ask"');
  equal(TurnType.REPLY, 'reply', 'TurnType.REPLY === "reply"');
  equal(TurnType.COMPLETE, 'complete', 'TurnType.COMPLETE === "complete"');
  equal(TurnType.OFF_TASK, 'off-task', 'TurnType.OFF_TASK === "off-task"');
  equal(TurnType.GIVEUP, 'giveup', 'TurnType.GIVEUP === "giveup"');
  equal(TurnType.VALIDATION_FAILED, 'validation_failed', 'TurnType.VALIDATION_FAILED === "validation_failed"');

  ok(Object.isFrozen(TurnType), 'TurnType 已冻结不可变');
  equal(Object.keys(TurnType).length, 6, 'TurnType 共 6 个键');
}

// ═══════════════════════════════════════════════════════════
// AskingField 枚举 (7 字段)
// ═══════════════════════════════════════════════════════════

function testAskingFieldEnum() {
  console.log('\n# ===== AskingField 七字段枚举 =====');

  equal(AskingField.INTENT, 'intent', 'AskingField.INTENT === "intent"');
  equal(AskingField.KEY, 'key', 'AskingField.KEY === "key"');
  equal(AskingField.CONTENT, 'content', 'AskingField.CONTENT === "content"');
  equal(AskingField.ATTACHMENT, 'attachment', 'AskingField.ATTACHMENT === "attachment"');
  equal(AskingField.TIME, 'time', 'AskingField.TIME === "time"');
  equal(AskingField.SEARCH_KEY, 'search_key', 'AskingField.SEARCH_KEY === "search_key"');
  equal(AskingField.ORGANIZE_ACTION, 'organize_action', 'AskingField.ORGANIZE_ACTION === "organize_action"');

  ok(Object.isFrozen(AskingField), 'AskingField 已冻结不可变');
  equal(Object.keys(AskingField).length, 7, 'AskingField 共 7 个键');
}

// ═══════════════════════════════════════════════════════════
// ChangeLevel 枚举 (3 值)
// ═══════════════════════════════════════════════════════════

function testChangeLevelEnum() {
  console.log('\n# ===== ChangeLevel 三值枚举 =====');

  equal(ChangeLevel.MAJOR, 'major', 'ChangeLevel.MAJOR === "major"');
  equal(ChangeLevel.MINOR, 'minor', 'ChangeLevel.MINOR === "minor"');
  equal(ChangeLevel.INVALID, 'invalid', 'ChangeLevel.INVALID === "invalid"');

  ok(Object.isFrozen(ChangeLevel), 'ChangeLevel 已冻结不可变');
  equal(Object.keys(ChangeLevel).length, 3, 'ChangeLevel 共 3 个键');
}

// ═══════════════════════════════════════════════════════════
// changeLevelDefaults
// ═══════════════════════════════════════════════════════════

function testChangeLevelDefaults() {
  console.log('\n# ===== changeLevelDefaults =====');

  equal(changeLevelDefaults.formatError, 'minor', 'changeLevelDefaults.formatError === "minor"');
  equal(changeLevelDefaults.changeLevelReasonDefault, '未提供', 'changeLevelDefaults.changeLevelReasonDefault === "未提供"');
  contains(changeLevelDefaults.onEmptyOrOverlength, 'DET 拦截', 'changeLevelDefaults.onEmptyOrOverlength 含 DET 拦截');
}

// ═══════════════════════════════════════════════════════════
// validateTurn
// ═══════════════════════════════════════════════════════════

function testValidateTurn() {
  console.log('\n# ===== validateTurn =====');

  // 有效 turn
  const valid = validateTurn({
    turnType: 'reply',
    changeLevel: 'minor',
    changeLevelReason: '测试',
    message: 'ok',
  });
  ok(valid.valid, 'validateTurn 有效 turn → valid=true');

  // 空对象
  const empty = validateTurn({});
  ok(!empty.valid, 'validateTurn 空对象 → valid=false');
  ok(empty.errors.length > 0, 'validateTurn 空对象 → 有错误');

  // 缺少 turnType
  const noType = validateTurn({ changeLevel: 'minor' });
  ok(!noType.valid, 'validateTurn 缺少 turnType → valid=false');

  // 非法 turnType
  const badType = validateTurn({ turnType: 'bad', changeLevel: 'minor' });
  ok(!badType.valid, 'validateTurn 非法 turnType → valid=false');

  // 缺少 changeLevel
  const noLevel = validateTurn({ turnType: 'reply' });
  ok(!noLevel.valid, 'validateTurn 缺少 changeLevel → valid=false');

  // changeLevel major 缺 reason
  const majorNoReason = validateTurn({ turnType: 'reply', changeLevel: 'major' });
  ok(!majorNoReason.valid, 'validateTurn changeLevel=major 缺 reason → valid=false');

  // changeLevel invalid 不需要 reason
  const invalidNoReason = validateTurn({ turnType: 'reply', changeLevel: 'invalid' });
  ok(invalidNoReason.valid, 'validateTurn changeLevel=invalid 无需 reason → valid=true');

  // message 超长
  const longMsg = validateTurn({ turnType: 'reply', changeLevel: 'minor', changeLevelReason: 'x', message: 'x'.repeat(31) });
  ok(!longMsg.valid, 'validateTurn message 超长三十字 → valid=false');

  // askingField 非法值
  const badAsk = validateTurn({ turnType: 'reply', changeLevel: 'minor', changeLevelReason: 'x', askingField: 'bad' });
  ok(!badAsk.valid, 'validateTurn askingField 非法值 → valid=false');

  // collectedFields 非对象
  const badCF = validateTurn({ turnType: 'reply', changeLevel: 'minor', changeLevelReason: 'x', collectedFields: [] });
  ok(!badCF.valid, 'validateTurn collectedFields 为数组 → valid=false');

  // null turn
  const nullTurn = validateTurn(null);
  ok(!nullTurn.valid, 'validateTurn null → valid=false');
  contains(nullTurn.errors[0], '非 null 对象', 'validateTurn null → 错误信息含"非 null 对象"');
}

// ═══════════════════════════════════════════════════════════
// createTurn
// ═══════════════════════════════════════════════════════════

function testCreateTurn() {
  console.log('\n# ===== createTurn =====');

  // 基础创建
  const t1 = createTurn({ turnType: 'reply' });
  equal(t1.turnType, 'reply', 'createTurn reply → turnType="reply"');
  equal(t1.changeLevel, 'minor', 'createTurn 默认 changeLevel="minor"');
  equal(t1.changeLevelReason, '未提供', 'createTurn 默认 changeLevelReason="未提供"');
  equal(t1.askingField, null, 'createTurn 默认 askingField=null');
  equal(t1.message, '', 'createTurn 默认 message=""');
  deepEqual(t1.collectedFields, {}, 'createTurn 默认 collectedFields={}');

  // 所有字段指定
  const t2 = createTurn({
    turnType: 'ask',
    askingField: 'key',
    changeLevel: 'major',
    changeLevelReason: '用户要求',
    message: '请输入 Key',
    collectedFields: { key: 'test' },
  });
  equal(t2.turnType, 'ask', 'createTurn ask → turnType="ask"');
  equal(t2.askingField, 'key', 'createTurn → askingField="key"');
  equal(t2.changeLevel, 'major', 'createTurn → changeLevel="major"');
  equal(t2.changeLevelReason, '用户要求', 'createTurn → changeLevelReason 保留');
  equal(t2.message, '请输入 Key', 'createTurn → message 保留');
  deepEqual(t2.collectedFields, { key: 'test' }, 'createTurn → collectedFields 保留');

  // 所有 key 不遗漏
  ok('turnType' in t2, 'createTurn 含 turnType');
  ok('askingField' in t2, 'createTurn 含 askingField');
  ok('changeLevel' in t2, 'createTurn 含 changeLevel');
  ok('changeLevelReason' in t2, 'createTurn 含 changeLevelReason');
  ok('message' in t2, 'createTurn 含 message');
  ok('collectedFields' in t2, 'createTurn 含 collectedFields');

  // 非法 turnType 应抛错
  throws(() => createTurn({ turnType: 'bad' }), 'createTurn 非法 turnType → throws');
  // 非法 changeLevel 应抛错
  throws(() => createTurn({ turnType: 'reply', changeLevel: 'bad' }), 'createTurn 非法 changeLevel → throws');
  // 缺 turnType 应抛错
  throws(() => createTurn({}), 'createTurn 缺 turnType → throws');
}

// ═══════════════════════════════════════════════════════════
// createValidationFailed
// ═══════════════════════════════════════════════════════════

function testCreateValidationFailed() {
  console.log('\n# ===== createValidationFailed =====');

  const vf = createValidationFailed('content too long');
  equal(vf.turnType, 'validation_failed', 'createValidationFailed → turnType="validation_failed"');
  equal(vf.changeLevel, 'invalid', 'createValidationFailed → changeLevel="invalid"');
  equal(vf.changeLevelReason, 'content too long', 'createValidationFailed → changeLevelReason 保留');
  equal(vf.message, '内容格式不符合要求', 'createValidationFailed → 默认 message');

  const vf2 = createValidationFailed('bad format', '格式不对');
  equal(vf2.message, '格式不对', 'createValidationFailed → 自定义 message');
}

// ═══════════════════════════════════════════════════════════
// isValidChangeLevel / isValidTurnType
// ═══════════════════════════════════════════════════════════

function testIsValidHelpers() {
  console.log('\n# ===== isValidChangeLevel / isValidTurnType =====');

  ok(isValidChangeLevel('major'), 'isValidChangeLevel("major") → true');
  ok(isValidChangeLevel('minor'), 'isValidChangeLevel("minor") → true');
  ok(isValidChangeLevel('invalid'), 'isValidChangeLevel("invalid") → true');
  ok(!isValidChangeLevel('bad'), 'isValidChangeLevel("bad") → false');
  ok(!isValidChangeLevel(''), 'isValidChangeLevel("") → false');

  ok(isValidTurnType('ask'), 'isValidTurnType("ask") → true');
  ok(isValidTurnType('reply'), 'isValidTurnType("reply") → true');
  ok(isValidTurnType('complete'), 'isValidTurnType("complete") → true');
  ok(isValidTurnType('off-task'), 'isValidTurnType("off-task") → true');
  ok(isValidTurnType('giveup'), 'isValidTurnType("giveup") → true');
  ok(isValidTurnType('validation_failed'), 'isValidTurnType("validation_failed") → true');
  ok(!isValidTurnType('bad'), 'isValidTurnType("bad") → false');
}

// ═══════════════════════════════════════════════════════════
// getTunable 默认值 (12 params)
// ═══════════════════════════════════════════════════════════

function testGetTunableDefaults() {
  console.log('\n# ===== getTunable 默认值 =====');

  const empty = {};

  equal(getTunable(empty, 'intent_confidence_direct'), 80, 'getTunable intent_confidence_direct 默认=80');
  equal(getTunable(empty, 'intent_confidence_confirm'), 60, 'getTunable intent_confidence_confirm 默认=60');
  equal(getTunable(empty, 'content_max_length'), 5000, 'getTunable content_max_length 默认=5000');
  equal(getTunable(empty, 'attachment_max_count'), 5, 'getTunable attachment_max_count 默认=5');
  equal(getTunable(empty, 'attachment_image_max_mb'), 10, 'getTunable attachment_image_max_mb 默认=10');
  equal(getTunable(empty, 'attachment_video_max_mb'), 100, 'getTunable attachment_video_max_mb 默认=100');
  equal(getTunable(empty, 'attachment_audio_max_mb'), 50, 'getTunable attachment_audio_max_mb 默认=50');
  equal(getTunable(empty, 'organize_default_days'), 7, 'getTunable organize_default_days 默认=7');
  equal(getTunable(empty, 'organize_skip_auto_discard'), 3, 'getTunable organize_skip_auto_discard 默认=3');
  equal(getTunable(empty, 'search_timeout_seconds'), 10, 'getTunable search_timeout_seconds 默认=10');
  equal(getTunable(empty, 'turnHistory_limit'), 20, 'getTunable turnHistory_limit 默认=20');
  equal(getTunable(empty, 'pending_fields_ttl'), 86400, 'getTunable pending_fields_ttl 默认=86400');

  // null state 也应返回默认值
  equal(getTunable(null, 'content_max_length'), 5000, 'getTunable null state → 默认=5000');
}

// ═══════════════════════════════════════════════════════════
// getTunable 自定义值
// ═══════════════════════════════════════════════════════════

function testGetTunableCustom() {
  console.log('\n# ===== getTunable 自定义值 =====');

  const state = { content_max_length: 2000, attachment_max_count: 3 };
  equal(getTunable(state, 'content_max_length'), 2000, 'getTunable 自定义 content_max_length=2000');
  equal(getTunable(state, 'attachment_max_count'), 3, 'getTunable 自定义 attachment_max_count=3');
  // 未设置的仍用默认
  equal(getTunable(state, 'organize_default_days'), 7, 'getTunable 未设置 organize_default_days → 默认=7');
}

// ═══════════════════════════════════════════════════════════
// getTunable 未知参数
// ═══════════════════════════════════════════════════════════

function testGetTunableUnknown() {
  console.log('\n# ===== getTunable 未知参数 =====');
  throws(() => getTunable({}, 'unknown'), 'getTunable 未知参数 → throws');
}

// ═══════════════════════════════════════════════════════════
// setTunable
// ═══════════════════════════════════════════════════════════

function testSetTunable() {
  console.log('\n# ===== setTunable =====');

  const state = {};

  // 正常范围内
  const r1 = setTunable(state, 'content_max_length', 3000);
  ok(r1.success, 'setTunable 范围内 → success=true');
  equal(r1.value, 3000, 'setTunable 范围内 → value=3000');
  equal(state.content_max_length, 3000, 'setTunable 范围内 → state 已更新');

  // 边界值
  const r2 = setTunable(state, 'content_max_length', 500);
  ok(r2.success, 'setTunable 下边界 500 → success=true');

  const r3 = setTunable(state, 'content_max_length', 50000);
  ok(r3.success, 'setTunable 上边界 50000 → success=true');

  // 超出范围
  const r4 = setTunable(state, 'content_max_length', 100);
  ok(!r4.success, 'setTunable 超下界 → success=false');
  contains(r4.error, '超出范围', 'setTunable 超下界 → error 含"超出范围"');

  const r5 = setTunable(state, 'content_max_length', 99999);
  ok(!r5.success, 'setTunable 超上界 → success=false');

  // 非数值
  const r6 = setTunable(state, 'content_max_length', 'abc');
  ok(!r6.success, 'setTunable 字符串 → success=false');
  contains(r6.error, '必须是数值', 'setTunable 字符串 → error 含"必须是数值"');

  // 未知参数
  const r7 = setTunable(state, 'unknown', 100);
  ok(!r7.success, 'setTunable 未知参数 → success=false');
  contains(r7.error, '未知参数', 'setTunable 未知参数 → error 含"未知参数"');

  // NaN
  const r8 = setTunable(state, 'content_max_length', NaN);
  ok(!r8.success, 'setTunable NaN → success=false');
}

// ═══════════════════════════════════════════════════════════
// detectConflicts
// ═══════════════════════════════════════════════════════════

function testDetectConflicts() {
  console.log('\n# ===== detectConflicts =====');

  // 默认值触发跨参数 warning（附件总量 5*10+100*100+50*50=12550 > 2000）
  const defaultState = createDefaultState();
  const r1 = detectConflicts(defaultState);
  ok(r1.conflicts.length >= 1, 'detectConflicts 默认值 → 有跨参数 warning');
  const defaultsWarn = r1.conflicts.find(c => c.severity === 'warning');
  ok(!!defaultsWarn, 'detectConflicts 默认值 → warning 存在');

  // 单参数冲突：intent_confidence_direct < intent_confidence_confirm
  const badState = createDefaultState();
  badState.intent_confidence_direct = 50;
  badState.intent_confidence_confirm = 90;
  const r2 = detectConflicts(badState);
  ok(r2.conflicts.length > 0, 'detectConflicts direct<confirm → 有冲突');
  const errConflict = r2.conflicts.find(c => c.severity === 'error');
  ok(!!errConflict, 'detectConflicts direct<confirm → severity="error"');
  contains(errConflict.description, 'intent_confidence', 'detectConflicts 错误描述含 intent_confidence');

  // 跨参数冲突：附件总量警告
  const hugeState = createDefaultState();
  hugeState.attachment_video_max_mb = 1000;
  hugeState.attachment_audio_max_mb = 500;
  const r3 = detectConflicts(hugeState);
  const warnConflict = r3.conflicts.find(c => c.severity === 'warning');
  ok(!!warnConflict, 'detectConflicts 附件总量超限 → 有 warning');
  contains(warnConflict.name, 'attachment', 'detectConflicts warning 名称含 attachment');
}

// ═══════════════════════════════════════════════════════════
// createDefaultState
// ═══════════════════════════════════════════════════════════

function testCreateDefaultState() {
  console.log('\n# ===== createDefaultState =====');

  const state = createDefaultState();
  equal(state.content_max_length, 5000, 'createDefaultState content_max_length=5000');
  equal(state.attachment_max_count, 5, 'createDefaultState attachment_max_count=5');
  equal(state.organize_default_days, 7, 'createDefaultState organize_default_days=7');
  equal(state.organize_skip_auto_discard, 3, 'createDefaultState organize_skip_auto_discard=3');
  equal(state.intent_confidence_direct, 80, 'createDefaultState intent_confidence_direct=80');
  equal(state.intent_confidence_confirm, 60, 'createDefaultState intent_confidence_confirm=60');
  equal(state.search_timeout_seconds, 10, 'createDefaultState search_timeout_seconds=10');
  equal(state.turnHistory_limit, 20, 'createDefaultState turnHistory_limit=20');
  equal(state.pending_fields_ttl, 86400, 'createDefaultState pending_fields_ttl=86400');

  equal(Object.keys(state).length, 12, 'createDefaultState 共 12 个参数');
}

// ═══════════════════════════════════════════════════════════
// getAllParamDefs / getParamDef / isValidTunableName
// ═══════════════════════════════════════════════════════════

function testParamDefs() {
  console.log('\n# ===== getAllParamDefs / getParamDef / isValidTunableName =====');

  const all = getAllParamDefs();
  equal(all.length, 12, 'getAllParamDefs → 12 个');

  const def = getParamDef('content_max_length');
  ok(!!def, 'getParamDef("content_max_length") 存在');
  equal(def.defaultValue, 5000, 'getParamDef content_max_length.defaultValue=5000');
  deepEqual(def.valueRange, [500, 50000], 'getParamDef content_max_length 范围 [500, 50000]');

  const def2 = getParamDef('unknown');
  equal(def2, undefined, 'getParamDef 未知参数 → undefined');

  ok(isValidTunableName('content_max_length'), 'isValidTunableName("content_max_length") → true');
  ok(!isValidTunableName('unknown'), 'isValidTunableName("unknown") → false');
}

main();
