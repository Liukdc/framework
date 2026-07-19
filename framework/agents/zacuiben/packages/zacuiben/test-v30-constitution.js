// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂碎本 v3.0 — 宪法测试
 *
 * 覆盖：root-constitution（8条不可变条款、deepFreeze、validateAgainstRoot）、
 *       constitution-sessions（5份环节宪法 + COMMON_RULES + buildPrompt）。
 *
 * 用法：
 *   node test-v30-constitution.js
 */

import {
  ROOT_CONSTITUTION, deepFreeze,
  validateAgainstRoot, verifyIntegrity,
  getArticle, getAllArticles,
} from './src/root-constitution.js';

import {
  COMMON_RULES,
  intentRecognitionConstitution, recordConstitution,
  searchConstitution, organizeConstitution, otherConstitution,
  getSessionConstitution, getAllSessionConstitutions,
  buildPrompt, buildCompactPrompt,
} from './src/constitution-sessions.js';

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

function isNull(actual, message) {
  tests++;
  if (actual === null) { passed++; console.log(`ok ${tests} - ${message}`); }
  else { failed++; console.log(`not ok ${tests} - ${message}`); console.log(`  ---`); console.log(`  expected: null`); console.log(`  actual:   ${JSON.stringify(actual)}`); console.log(`  ...`); }
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

function main() {
  console.log('TAP version 14');

  testRootConstitution();
  testDeepFreeze();
  testValidateAgainstRoot();
  testVerifyIntegrity();
  testArticleAccess();
  testCommonRules();
  testIntentRecognition();
  testRecordConstitution();
  testSearchConstitution();
  testOrganizeConstitution();
  testOtherConstitution();
  testSessionAccess();
  testBuildPrompt();

  console.log(`1..${tests}`);
  console.log(`\n# ${passed}/${tests} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ═══════════════════════════════════════════════════════════
// 根宪法 — 8 条不可变条款
// ═══════════════════════════════════════════════════════════

function testRootConstitution() {
  console.log('\n# ===== ROOT_CONSTITUTION — 8 条不可变 =====');

  ok(!!ROOT_CONSTITUTION, 'ROOT_CONSTITUTION 存在');
  equal(ROOT_CONSTITUTION.constitution, 'root', 'constitution === "root"');
  equal(ROOT_CONSTITUTION.version, 'v3.0', 'version === "v3.0"');
  ok(Array.isArray(ROOT_CONSTITUTION.articles), 'articles 是数组');
  equal(ROOT_CONSTITUTION.articles.length, 8, 'articles 共 8 条');

  // 每条条款结构
  for (let i = 0; i < ROOT_CONSTITUTION.articles.length; i++) {
    const a = ROOT_CONSTITUTION.articles[i];
    ok(typeof a.id === 'number', `article[${i}].id 是 number`);
    ok(typeof a.name === 'string', `article[${i}].name 是 string`);
    ok(typeof a.content === 'string', `article[${i}].content 是 string`);
    equal(a.type, 'immutable', `article[${i}].type === "immutable"`);
  }

  // 特定条款名称
  const names = ROOT_CONSTITUTION.articles.map(a => a.name);
  ok(names.includes('安全红线'), '含"安全红线"');
  ok(names.includes('元指令'), '含"元指令"');
  ok(names.includes('收敛义务'), '含"收敛义务"');
  ok(names.includes('输出格式'), '含"输出格式"');
  ok(names.includes('跨任务延伸检测'), '含"跨任务延伸检测"');
  ok(names.includes('状态间数据传递'), '含"状态间数据传递"');
  ok(names.includes('三类保护机制'), '含"三类保护机制"');
  ok(names.includes('模糊目标处理'), '含"模糊目标处理"');

  // 根宪法已冻结
  ok(Object.isFrozen(ROOT_CONSTITUTION), 'ROOT_CONSTITUTION 已冻结');
  ok(Object.isFrozen(ROOT_CONSTITUTION.articles), 'ROOT_CONSTITUTION.articles 已冻结');

  // 每条条款也已冻结
  for (const a of ROOT_CONSTITUTION.articles) {
    ok(Object.isFrozen(a), `article ${a.id} "${a.name}" 已冻结`);
  }

  // 检查宪法内容关键词 — "不分类/不打扰/不丢失" 类概念
  const allContent = ROOT_CONSTITUTION.articles.map(a => a.content).join(' ');
  // "不分类" 等价概念：元指令"不修改、不概括、不解释"
  contains(allContent, '不修改', '宪法含"不修改"（不分类概念）');
  contains(allContent, '不概括', '宪法含"不概括"');
  // "不打扰" 等价概念：每次只做一件事
  contains(allContent, '每次只做一件事', '宪法含"每次只做一件事"（不打扰概念）');
  // "不丢失" 等价概念：三类保护机制中的"不清理未到期记录"
  contains(allContent, '不清理未到期记录', '宪法含"不清理未到期记录"（不丢失概念）');
  contains(allContent, '不上传', '宪法含"不上传"');
}

// ═══════════════════════════════════════════════════════════
// deepFreeze
// ═══════════════════════════════════════════════════════════

function testDeepFreeze() {
  console.log('\n# ===== deepFreeze =====');

  // 基础冻结
  const obj1 = { a: 1, b: 2 };
  const frozen1 = deepFreeze(obj1);
  ok(Object.isFrozen(frozen1), 'deepFreeze 顶层冻结');
  equal(frozen1.a, 1, 'deepFreeze 后值可读');

  // 嵌套冻结
  const obj2 = { outer: { inner: { value: 42 } } };
  const frozen2 = deepFreeze(obj2);
  ok(Object.isFrozen(frozen2), 'deepFreeze 嵌套顶层冻结');
  ok(Object.isFrozen(frozen2.outer), 'deepFreeze 嵌套第一层冻结');
  ok(Object.isFrozen(frozen2.outer.inner), 'deepFreeze 嵌套第二层冻结');
  equal(frozen2.outer.inner.value, 42, 'deepFreeze 嵌套值可读');

  // 数组冻结
  const obj3 = { items: ['a', 'b', 'c'] };
  const frozen3 = deepFreeze(obj3);
  ok(Object.isFrozen(frozen3.items), 'deepFreeze 数组冻结');

  // null / 原始值
  equal(deepFreeze(null), null, 'deepFreeze(null) → null');
  equal(deepFreeze(42), 42, 'deepFreeze(42) → 42');
  equal(deepFreeze('hello'), 'hello', 'deepFreeze("hello") → "hello"');

  // 不重复冻结已冻结对象
  const alreadyFrozen = Object.freeze({ x: 1 });
  ok(Object.isFrozen(deepFreeze(alreadyFrozen)), 'deepFreeze 已冻结对象 → 仍冻结');
}

// ═══════════════════════════════════════════════════════════
// validateAgainstRoot
// ═══════════════════════════════════════════════════════════

function testValidateAgainstRoot() {
  console.log('\n# ===== validateAgainstRoot =====');

  // null 对象
  const r1 = validateAgainstRoot(null);
  ok(!r1.valid, 'validateAgainstRoot null → valid=false');
  equal(r1.violations.length, 1, 'validateAgainstRoot null → 1 条违反');
  equal(r1.violations[0].article, 4, 'validateAgainstRoot null → 违反第4条');

  // 有效输出
  const r2 = validateAgainstRoot({
    turnType: 'reply',
    changeLevel: 'minor',
    changeLevelReason: 'ok',
    message: '好的',
  });
  ok(r2.valid, 'validateAgainstRoot 有效输出 → valid=true');
  equal(r2.violations.length, 0, 'validateAgainstRoot 有效输出 → 0 条违反');

  // 非法 turnType
  const r3 = validateAgainstRoot({
    turnType: 'bad_type',
    changeLevel: 'minor',
    changeLevelReason: 'ok',
  });
  ok(!r3.valid, 'validateAgainstRoot 非法 turnType → valid=false');
  equal(r3.violations[0].article, 4, 'validateAgainstRoot 非法 turnType → 违反第4条');

  // 缺 changeLevel
  const r4 = validateAgainstRoot({ turnType: 'reply' });
  ok(!r4.valid, 'validateAgainstRoot 缺 changeLevel → valid=false');

  // message 超长
  const r5 = validateAgainstRoot({
    turnType: 'reply',
    changeLevel: 'minor',
    changeLevelReason: 'ok',
    message: 'x'.repeat(31),
  });
  ok(!r5.valid, 'validateAgainstRoot message 超长 → valid=false');

  // 元指令：原始输入被修改
  const r6 = validateAgainstRoot(
    { turnType: 'reply', changeLevel: 'minor', changeLevelReason: 'x', collectedFields: { content: '修改后的内容' } },
    { originalInput: '原始内容' }
  );
  ok(!r6.valid, 'validateAgainstRoot content 与原始输入不一致 → valid=false');
  equal(r6.violations[0].article, 2, 'validateAgainstRoot content 不一致 → 违反第2条（元指令）');

  // 元指令：原始输入一致
  const r7 = validateAgainstRoot(
    { turnType: 'reply', changeLevel: 'minor', changeLevelReason: 'x', collectedFields: { content: '一致内容' } },
    { originalInput: '一致内容' }
  );
  ok(r7.valid, 'validateAgainstRoot content 与原始输入一致 → valid=true');
}

// ═══════════════════════════════════════════════════════════
// verifyIntegrity
// ═══════════════════════════════════════════════════════════

function testVerifyIntegrity() {
  console.log('\n# ===== verifyIntegrity =====');

  const result = verifyIntegrity();
  ok(result.frozen, 'verifyIntegrity → frozen=true');
  equal(result.articleCount, 8, 'verifyIntegrity → articleCount=8');
}

// ═══════════════════════════════════════════════════════════
// getArticle / getAllArticles
// ═══════════════════════════════════════════════════════════

function testArticleAccess() {
  console.log('\n# ===== getArticle / getAllArticles =====');

  const a1 = getArticle(1);
  ok(!!a1, 'getArticle(1) 存在');
  equal(a1.name, '安全红线', 'getArticle(1) → "安全红线"');

  const a8 = getArticle(8);
  equal(a8.name, '模糊目标处理', 'getArticle(8) → "模糊目标处理"');

  const a0 = getArticle(0);
  equal(a0, undefined, 'getArticle(0) → undefined');

  const a99 = getArticle(99);
  equal(a99, undefined, 'getArticle(99) → undefined');

  const all = getAllArticles();
  equal(all.length, 8, 'getAllArticles → 8 条');
}

// ═══════════════════════════════════════════════════════════
// COMMON_RULES
// ═══════════════════════════════════════════════════════════

function testCommonRules() {
  console.log('\n# ===== COMMON_RULES =====');

  ok(!!COMMON_RULES, 'COMMON_RULES 存在');
  equal(COMMON_RULES.constitution, 'common-rules', 'constitution === "common-rules"');
  equal(COMMON_RULES.version, 'v3.0', 'version === "v3.0"');
  ok(Array.isArray(COMMON_RULES.rules), 'rules 是数组');
  equal(COMMON_RULES.rules.length, 3, 'COMMON_RULES 共 3 条');

  // 规则1：输出格式
  equal(COMMON_RULES.rules[0].name, '输出格式', '规则1: "输出格式"');
  contains(COMMON_RULES.rules[0].content, 'turnType 六值齐全', '规则1 含 turnType 六值');

  // 规则2：角色真实
  equal(COMMON_RULES.rules[1].name, '角色真实', '规则2: "角色真实"');
  contains(COMMON_RULES.rules[1].content, '不替用户做任何分类', '规则2 含"不替用户做任何分类"');
  contains(COMMON_RULES.rules[1].content, '30 字以内', '规则2 含"30 字以内"');

  // 规则3：跨任务延伸检测
  equal(COMMON_RULES.rules[2].name, '跨任务延伸检测', '规则3: "跨任务延伸检测"');
  contains(COMMON_RULES.rules[2].content, 'needSemanticExtensionCheck=false', '规则3 含 needSemanticExtensionCheck=false');

  ok(Object.isFrozen(COMMON_RULES), 'COMMON_RULES 已冻结');
}

// ═══════════════════════════════════════════════════════════
// 意图识别宪法 — 5 意图 + 3 级阈值
// ═══════════════════════════════════════════════════════════

function testIntentRecognition() {
  console.log('\n# ===== intentRecognition 宪法 =====');

  equal(intentRecognitionConstitution.intent, 'intent-recognition', 'intent === "intent-recognition"');
  equal(intentRecognitionConstitution.taskType, 'field_based', 'taskType === "field_based"');
  equal(intentRecognitionConstitution.importance, 'high', 'importance === "high"');

  // 5 意图值
  const values = intentRecognitionConstitution.fieldRules.intent.values;
  ok(Array.isArray(values), 'intent.values 是数组');
  equal(values.length, 5, 'intent.values 共 5 个');
  ok(values.includes('record'), 'intent 含 record');
  ok(values.includes('search'), 'intent 含 search');
  ok(values.includes('organize'), 'intent 含 organize');
  ok(values.includes('setting'), 'intent 含 setting');
  ok(values.includes('other'), 'intent 含 other');

  // 3 级阈值
  const thresholds = intentRecognitionConstitution.fieldRules.intent.thresholds;
  deepEqual(thresholds.direct, [80, 100], '阈值 direct = [80, 100]');
  deepEqual(thresholds.confirm, [60, 80], '阈值 confirm = [60, 80]');
  deepEqual(thresholds.guide, [0, 60], '阈值 guide = [0, 60]');

  // completionCondition
  contains(intentRecognitionConstitution.completionCondition, 'intent ∈ 五值', 'completionCondition 含 intent ∈ 五值');
}

// ═══════════════════════════════════════════════════════════
// 录入宪法
// ═══════════════════════════════════════════════════════════

function testRecordConstitution() {
  console.log('\n# ===== recordConstitution 录入宪法 =====');

  equal(recordConstitution.intent, 'record', 'intent === "record"');
  equal(recordConstitution.importance, 'critical', 'importance === "critical"');

  // Key 规则：check_key_has_noun
  ok(!!recordConstitution.fieldRules.key, 'fieldRules.key 存在');
  equal(recordConstitution.fieldRules.key.method, 'custom', 'key.method === "custom"');
  equal(recordConstitution.fieldRules.key.function, 'check_key_has_noun', 'key.function === "check_key_has_noun"');
  ok(recordConstitution.fieldRules.key.allowTempKey, 'key.allowTempKey=true');

  // Content 规则
  equal(recordConstitution.fieldRules.content.method, 'length', 'content.method === "length"');
  equal(recordConstitution.fieldRules.content.max, 5000, 'content.max === 5000');

  // Attachment 规则
  equal(recordConstitution.fieldRules.attachments.method, 'custom', 'attachments.method === "custom"');
  equal(recordConstitution.fieldRules.attachments.limits.maxCount, 5, 'attachments.limits.maxCount=5');
  equal(recordConstitution.fieldRules.attachments.limits.imageMaxMb, 10, 'attachments.limits.imageMaxMb=10');
  equal(recordConstitution.fieldRules.attachments.limits.videoMaxMb, 100, 'attachments.limits.videoMaxMb=100');
  equal(recordConstitution.fieldRules.attachments.limits.audioMaxMb, 50, 'attachments.limits.audioMaxMb=50');

  // OrganizeTime 规则
  ok(!!recordConstitution.fieldRules.organizeTime, 'fieldRules.organizeTime 存在');
  equal(recordConstitution.fieldRules.organizeTime.function, 'check_time_or_defaults', 'organizeTime.function === "check_time_or_defaults"');

  // 校验规则含 check_key_has_noun
  const validationRules = recordConstitution.validation.rules;
  const keyRule = validationRules.find(r => r.field === 'currentRecord.key');
  ok(!!keyRule, 'validation 含 currentRecord.key 规则');
  equal(keyRule.function, 'check_key_has_noun', 'key validation → check_key_has_noun');
}

// ═══════════════════════════════════════════════════════════
// 检索宪法 — exact_match 非语义搜索
// ═══════════════════════════════════════════════════════════

function testSearchConstitution() {
  console.log('\n# ===== searchConstitution 检索宪法 =====');

  equal(searchConstitution.intent, 'search', 'intent === "search"');
  equal(searchConstitution.fieldRules.searchKey.method, 'exact_match', 'searchKey.method === "exact_match"');
  contains(searchConstitution.fieldRules.searchKey.description, '精确匹配', 'searchKey 含"精确匹配"');
  contains(searchConstitution.fieldRules.searchKey.description, '不语义搜索', 'searchKey 含"不语义搜索"');

  // timeSpecifier 规则
  ok(!!searchConstitution.fieldRules.timeSpecifier, 'timeSpecifier 存在');
  equal(searchConstitution.fieldRules.timeSpecifier.function, 'check_time_or_defaults', 'timeSpecifier.function === "check_time_or_defaults"');

  // outputSchema turnType
  contains(searchConstitution.outputSchema.turnType, 'reply', 'search outputSchema 含 reply');
}

// ═══════════════════════════════════════════════════════════
// 整理宪法 — skipCount≥3 自动废弃
// ═══════════════════════════════════════════════════════════

function testOrganizeConstitution() {
  console.log('\n# ===== organizeConstitution 整理宪法 =====');

  equal(organizeConstitution.intent, 'organize', 'intent === "organize"');

  // organizeAction 5 值
  const actions = organizeConstitution.fieldRules.organizeAction.values;
  equal(actions.length, 5, 'organizeAction 共 5 个值');
  ok(actions.includes('name'), 'organizeAction 含 name');
  ok(actions.includes('done'), 'organizeAction 含 done');
  ok(actions.includes('skip'), 'organizeAction 含 skip');
  ok(actions.includes('discard'), 'organizeAction 含 discard');
  ok(actions.includes('exit'), 'organizeAction 含 exit');

  // skipCount 规则：max=3，自动废弃
  equal(organizeConstitution.fieldRules.skipCount.method, 'range', 'skipCount.method === "range"');
  equal(organizeConstitution.fieldRules.skipCount.max, 3, 'skipCount.max === 3');
  contains(organizeConstitution.fieldRules.skipCount.description, 'skipCount≥3→自动废弃', 'skipCount 含自动废弃规则');

  // displayRules
  ok(!!organizeConstitution.displayRules, 'displayRules 存在');
  contains(organizeConstitution.displayRules.priority, '临时 Key 优先', 'displayRules.priority 含"临时 Key 优先"');
}

// ═══════════════════════════════════════════════════════════
// 其他宪法 — 兜底引导语
// ═══════════════════════════════════════════════════════════

function testOtherConstitution() {
  console.log('\n# ===== otherConstitution 兜底宪法 =====');

  equal(otherConstitution.intent, 'other', 'intent === "other"');
  equal(otherConstitution.importance, 'low', 'importance === "low"');

  // 兜底模板
  const tpl = otherConstitution.fallbackTemplate;
  ok(typeof tpl === 'string' && tpl.length > 0, 'fallbackTemplate 存在且非空');
  contains(tpl, '没听明白', 'fallbackTemplate 含"没听明白"');
  contains(tpl, '杂碎本', 'fallbackTemplate 含"杂碎本"');

  // outputSchema turnType 固定 reply
  equal(otherConstitution.outputSchema.turnType, 'reply', 'other outputSchema.turnType === "reply"');
  isNull(otherConstitution.outputSchema.askingField, 'other outputSchema.askingField === null');
  equal(otherConstitution.outputSchema.changeLevel, 'invalid', 'other outputSchema.changeLevel === "invalid"');

  // reply 规则
  equal(otherConstitution.fieldRules.reply.method, 'static_template', 'other reply.method === "static_template"');
}

// ═══════════════════════════════════════════════════════════
// 环节宪法索引访问
// ═══════════════════════════════════════════════════════════

function testSessionAccess() {
  console.log('\n# ===== getSessionConstitution / getAllSessionConstitutions =====');

  ok(!!getSessionConstitution('intent-recognition'), 'getSession("intent-recognition") 存在');
  ok(!!getSessionConstitution('record'), 'getSession("record") 存在');
  ok(!!getSessionConstitution('search'), 'getSession("search") 存在');
  ok(!!getSessionConstitution('organize'), 'getSession("organize") 存在');
  ok(!!getSessionConstitution('other'), 'getSession("other") 存在');
  equal(getSessionConstitution('unknown'), undefined, 'getSession("unknown") → undefined');

  const all = getAllSessionConstitutions();
  equal(all.length, 5, 'getAllSessionConstitutions → 5 份宪法');
}

// ═══════════════════════════════════════════════════════════
// buildPrompt / buildCompactPrompt
// ═══════════════════════════════════════════════════════════

function testBuildPrompt() {
  console.log('\n# ===== buildPrompt / buildCompactPrompt =====');

  // buildPrompt 空宪法
  equal(buildPrompt(null), '', 'buildPrompt(null) → ""');

  // buildPrompt intent-recognition
  const p1 = buildPrompt(intentRecognitionConstitution, {
    fields: { content: '测试文本' },
    tunables: { content_max_length: 5000, attachment_max_count: 5 },
  });
  ok(p1.length > 0, 'buildPrompt intent-recognition → 非空');
  contains(p1, '@constitution root v3.0', 'buildPrompt 含根宪法标记');
  contains(p1, '@constitution common-rules v3.0', 'buildPrompt 含公共规则标记');
  contains(p1, '@constitution intent-recognition', 'buildPrompt 含环节宪法标记');
  contains(p1, 'field:intent', 'buildPrompt 含 field:intent');
  contains(p1, '@section output-schema', 'buildPrompt 含 output-schema');
  contains(p1, '@section tunables-snapshot', 'buildPrompt 含 tunables-snapshot');
  contains(p1, 'content_max_length: 5000', 'buildPrompt 含 content_max_length 快照');

  // buildPrompt record
  const p2 = buildPrompt(recordConstitution, {});
  contains(p2, '@constitution record', 'buildPrompt record → 含 @constitution record');
  contains(p2, 'field:key', 'buildPrompt record → 含 field:key');

  // buildPrompt other
  const p3 = buildPrompt(otherConstitution, {});
  contains(p3, '@constitution other', 'buildPrompt other → 含 @constitution other');

  // buildCompactPrompt
  const cp1 = buildCompactPrompt(intentRecognitionConstitution, { fields: { content: '你好' } });
  ok(cp1.length > 0, 'buildCompactPrompt 非空');
  contains(cp1, '杂碎本', 'buildCompactPrompt 含"杂碎本"');
  contains(cp1, '当前记录：你好', 'buildCompactPrompt 含当前记录');

  const cp2 = buildCompactPrompt(null);
  equal(cp2, '', 'buildCompactPrompt(null) → ""');
}

main();
