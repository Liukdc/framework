// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * v4.0 宪法层测试套件
 *
 * 运行方式: node test-v40-constitution.js
 * 覆盖模块: root-constitution.js, constitution-record.js, constitution-sessions.js
 */

import {
  ROOT_CONSTITUTION,
  ARTICLE1_META_INSTRUCTION,
  ARTICLE2_CONVERGENCE,
  ARTICLE3_OUTPUT_FORMAT,
  ARTICLE4_DEGRADATION,
  ARTICLE5_ARBITRATION,
  ARTICLE6_TRANSITION_GUARD,
  ARTICLE7_AMBIGUOUS_GOAL,
  deepFreeze,
  validateAgainstRoot,
  getOverridable,
} from './src/root-constitution.js';

import {
  RECORD_FIELD_RULES,
  RECORD_VALIDATION_RULES,
  RECORD_REQUIRED_FIELDS,
  RECORD_ASK_RULES,
  detValidateRecord,
  recordConstitution,
  buildRecordPrompt,
} from './src/constitution-record.js';

import {
  intentRecognitionConstitution,
  queryConstitution,
  deleteConstitution,
  compareConstitution,
  otherConstitution,
  exitConstitution,
  buildIntentRecognitionPrompt,
  buildQueryPrompt,
  buildDeletePrompt,
  buildComparePrompt,
  CONSTITUTION_BY_INTENT,
} from './src/constitution-sessions.js';

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
  console.log(`# v4.0 宪法层测试 — ${new Date().toISOString()}\n`);

  // ═══════════════════════════════════════════════════
  // 第一部分: root-constitution.js
  // ═══════════════════════════════════════════════════
  console.log('# ── root-constitution.js ──');

  // 1. ROOT_CONSTITUTION 有 7 条
  test('ROOT_CONSTITUTION 有 7 条', () => {
    assert(Array.isArray(ROOT_CONSTITUTION));
    assert(ROOT_CONSTITUTION.length === 7, `Expected 7, got ${ROOT_CONSTITUTION.length}`);
  });

  // 2. deepFreeze 递归冻结验证
  test('deepFreeze 递归冻结嵌套对象', () => {
    const obj = { a: 1, b: { c: 2, d: { e: 3 } } };
    const frozen = deepFreeze(obj);
    assert(Object.isFrozen(frozen), 'Top level should be frozen');
    assert(Object.isFrozen(frozen.b), 'Nested level 1 should be frozen');
    assert(Object.isFrozen(frozen.b.d), 'Nested level 2 should be frozen');
  });

  // 3. deepFreeze 处理 null/非对象
  test('deepFreeze null → null', () => {
    assert(deepFreeze(null) === null);
  });
  test('deepFreeze 字符串 → 原值返回', () => {
    assert(deepFreeze('hello') === 'hello');
  });

  // 4. validateAgainstRoot 空对象 → valid
  test('validateAgainstRoot 空对象 → valid', () => {
    const r = validateAgainstRoot({});
    assert(r.valid === true);
    assert(r.violations.length === 0);
  });

  // 5. validateAgainstRoot 缩减 l1Retries → invalid
  test('validateAgainstRoot l1Retries=0 → invalid', () => {
    const r = validateAgainstRoot({ l1Retries: 0 });
    assert(r.valid === false);
    assert(r.violations.some(v => v.includes('L1')));
  });

  // 6. validateAgainstRoot 修改 outputSchema → invalid
  test('validateAgainstRoot outputSchema="xml" → invalid', () => {
    const r = validateAgainstRoot({ outputSchema: 'xml' });
    assert(r.valid === false);
    assert(r.violations.some(v => v.includes('输出格式')));
  });

  // 7. validateAgainstRoot 覆盖 forbidden 条款
  test('validateAgainstRoot 覆盖 article1 (forbidden) → invalid', () => {
    const r = validateAgainstRoot({ article1: 'modified' });
    assert(r.valid === false);
    assert(r.violations.some(v => v.includes('禁止覆盖')));
  });

  // 8. getOverridable(1) → "forbidden"
  test('getOverridable(1) → "forbidden"', () => {
    assert(getOverridable(1) === 'forbidden');
  });

  // 9. getOverridable(4) → "extensible_only"
  test('getOverridable(4) → "extensible_only"', () => {
    assert(getOverridable(4) === 'extensible_only');
  });

  // 10. getOverridable 不存在编号 → "forbidden"
  test('getOverridable(99) → "forbidden"', () => {
    assert(getOverridable(99) === 'forbidden');
  });

  // 11. 口令词表包含 3 个口令
  test('ARTICLE1 口令词表包含 3 个口令', () => {
    const pp = ARTICLE1_META_INSTRUCTION.passphrases;
    assert(pp.wake === '小安开账');
    assert(pp.exit === '结束并且退出');
    assert(pp.cancel === '本次动作取消');
  });

  // 12. 每条宪法存在且 overridable 正确
  test('条款2 收敛义务 overridable=forbidden', () => {
    assert(ARTICLE2_CONVERGENCE.overridable === 'forbidden');
  });
  test('条款3 输出格式 overridable=forbidden', () => {
    assert(ARTICLE3_OUTPUT_FORMAT.overridable === 'forbidden');
  });
  test('条款5 仲裁权 overridable=forbidden', () => {
    assert(ARTICLE5_ARBITRATION.overridable === 'forbidden');
  });
  test('条款6 节点转换守卫 overridable=forbidden', () => {
    assert(ARTICLE6_TRANSITION_GUARD.overridable === 'forbidden');
  });
  test('条款7 模糊目标 overridable=forbidden', () => {
    assert(ARTICLE7_AMBIGUOUS_GOAL.overridable === 'forbidden');
  });

  // 13. ARTICLE4 降级链结构
  test('ARTICLE4 降级链含 5 级 + L2 禁用语', () => {
    assert(ARTICLE4_DEGRADATION.degradationChain.length === 5);
    assert(ARTICLE4_DEGRADATION.l1Retries === 1);
    assert(ARTICLE4_DEGRADATION.l2ForbiddenTerms.length >= 5);
    assert(typeof ARTICLE4_DEGRADATION.hardcodedFallback === 'string');
  });

  // 14. ARTICLE6 offTaskKeywords 结构
  test('ARTICLE6 offTaskKeywords 含 query/delete/exit', () => {
    const kw = ARTICLE6_TRANSITION_GUARD.offTaskKeywords;
    assert(Array.isArray(kw.query));
    assert(Array.isArray(kw.delete));
    assert(Array.isArray(kw.exit));
    assert(kw.query.includes('查一下'));
  });

  // 15. ARTICLE7 模板结构
  test('ARTICLE7 含 record 和 query 模板', () => {
    assert(ARTICLE7_AMBIGUOUS_GOAL.templates.record !== undefined);
    assert(ARTICLE7_AMBIGUOUS_GOAL.templates.query !== undefined);
  });

  // ═══════════════════════════════════════════════════
  // 第二部分: constitution-record.js
  // ═══════════════════════════════════════════════════
  console.log('\n# ── constitution-record.js ──');

  // 16. recordConstitution('simple') 含 category/amount/time
  test('recordConstitution simple 含 category/amount/time', () => {
    const text = recordConstitution('simple');
    assert(text.includes('种类'));
    assert(text.includes('金额'));
    assert(text.includes('时间'));
    assert(!text.includes('数量(含单位)'));
  });

  // 17. recordConstitution('detailed') 含 quantity
  test('recordConstitution detailed 含 数量', () => {
    const text = recordConstitution('detailed');
    assert(text.includes('数量'));
  });

  // 18. detValidateRecord amount=0 → invalid
  test('detValidateRecord amount=0 → invalid', () => {
    const r = detValidateRecord({ amount: 0 });
    assert(r.valid === false);
    assert(r.field === 'amount');
  });

  // 19. detValidateRecord amount=35 → valid
  test('detValidateRecord amount=35 → valid', () => {
    const r = detValidateRecord({ amount: 35 });
    assert(r.valid === true);
  });

  // 20. detValidateRecord time='明天' → invalid (future)
  test("detValidateRecord time='明天' → invalid (future)", () => {
    const r = detValidateRecord({ time: '明天', amount: 35 });
    assert(r.valid === false);
    assert(r.field === 'time');
  });

  // 21. detValidateRecord time='昨天' → valid
  test("detValidateRecord time='昨天' → valid", () => {
    const r = detValidateRecord({ amount: 35, time: '昨天' });
    assert(r.valid === true);
  });

  // 22. detValidateRecord quantity=0 → invalid
  test('detValidateRecord quantity=0 → invalid', () => {
    const r = detValidateRecord({ quantity: 0, amount: 35, time: '昨天' });
    assert(r.valid === false);
    assert(r.field === 'quantity');
  });

  // 23. detValidateRecord amount>999999 → invalid
  test('detValidateRecord amount=1000000 → invalid', () => {
    const r = detValidateRecord({ amount: 1000000 });
    assert(r.valid === false);
    assert(r.field === 'amount');
  });

  // 24. buildRecordPrompt 返回 {system, user}
  test('buildRecordPrompt 返回 {system, user}', () => {
    const result = buildRecordPrompt({
      userInput: '猫粮25',
      collectedFields: { category: '猫粮' },
    });
    assert(typeof result.system === 'string');
    assert(typeof result.user === 'string');
    assert(result.user.includes('猫粮25'));
  });

  // 25. RECORD_FIELD_RULES 4 字段按 order
  test('RECORD_FIELD_RULES 含 4 字段: category/amount/time/quantity', () => {
    const fields = RECORD_FIELD_RULES.fields;
    assert(fields.length === 4);
    assert(fields[0].name === 'category');
    assert(fields[0].order === 1);
    assert(fields[1].name === 'amount');
    assert(fields[1].order === 2);
    assert(fields[2].name === 'time');
    assert(fields[2].order === 3);
    assert(fields[3].name === 'quantity');
    assert(fields[3].order === 4);
  });

  // 26. RECORD_VALIDATION_RULES 结构
  test('RECORD_VALIDATION_RULES 含 amount/time/quantity 规则', () => {
    const rules = RECORD_VALIDATION_RULES;
    assert(rules.length === 4);
    const fields = rules.map(r => r.field);
    assert(fields.includes('amount'));
    assert(fields.includes('time'));
    assert(fields.includes('quantity'));
  });

  // 27. RECORD_REQUIRED_FIELDS = [category, amount, time]
  test('RECORD_REQUIRED_FIELDS = [category, amount, time]', () => {
    assert(RECORD_REQUIRED_FIELDS.length === 3);
    assert(RECORD_REQUIRED_FIELDS.includes('category'));
    assert(RECORD_REQUIRED_FIELDS.includes('amount'));
    assert(RECORD_REQUIRED_FIELDS.includes('time'));
  });

  // ═══════════════════════════════════════════════════
  // 第三部分: constitution-sessions.js
  // ═══════════════════════════════════════════════════
  console.log('\n# ── constitution-sessions.js ──');

  // 28. intentRecognitionConstitution 含 6 种意图
  test('intentRecognitionConstitution 含 6 种意图', () => {
    const text = intentRecognitionConstitution();
    assert(text.includes('record'));
    assert(text.includes('query'));
    assert(text.includes('delete'));
    assert(text.includes('compare'));
    assert(text.includes('exit'));
    assert(text.includes('other'));
  });

  // 29. queryConstitution 含 A/B/C/D 查询规则
  test('queryConstitution 含 A/B/C/D 查询规则', () => {
    const text = queryConstitution();
    assert(text.includes('single'));
    assert(text.includes('sum'));
    assert(text.includes('compare'));
    assert(text.includes('fuzzy'));
  });

  // 30. deleteConstitution 含 WAITING_CONFIRM 流程
  test('deleteConstitution 含 WAITING_CONFIRM 流程', () => {
    const text = deleteConstitution();
    assert(text.includes('确认删除'));
    assert(text.includes('WAITING_CONFIRM'));
  });

  // 31. otherConstitution 含 turnType=complete
  test('otherConstitution 含 turnType=complete', () => {
    const text = otherConstitution();
    assert(text.includes('complete'));
    assert(text.includes('小安只能记账'));
  });

  // 32. exitConstitution 含 turnType=complete
  test('exitConstitution 含退出告别', () => {
    const text = exitConstitution();
    assert(text.includes('turnType'));
    assert(text.includes('complete'));
  });

  // 33. buildIntentRecognitionPrompt 返回 {system, user}
  test('buildIntentRecognitionPrompt 返回 {system, user}', () => {
    const result = buildIntentRecognitionPrompt({ userInput: '猫粮25' });
    assert(typeof result.system === 'string');
    assert(typeof result.user === 'string');
    assert(result.user.includes('猫粮25'));
  });

  // 34. buildQueryPrompt 返回 {system, user}
  test('buildQueryPrompt 返回 {system, user}', () => {
    const result = buildQueryPrompt({ userInput: '这个月花了多少', subType: 'sum', collectedFields: {} });
    assert(typeof result.system === 'string');
    assert(typeof result.user === 'string');
  });

  // 35. buildDeletePrompt 返回 {system, user}
  test('buildDeletePrompt 返回 {system, user}', () => {
    const result = buildDeletePrompt({ userInput: '删掉午饭', collectedFields: {} });
    assert(typeof result.system === 'string');
    assert(typeof result.user === 'string');
  });

  // 36. buildComparePrompt 返回 {system, user}
  test('buildComparePrompt 返回 {system, user}', () => {
    const result = buildComparePrompt({ userInput: '三月和一月对比', collectedFields: {} });
    assert(typeof result.system === 'string');
    assert(typeof result.user === 'string');
  });

  // 37. CONSTITUTION_BY_INTENT 映射表完整性
  test('CONSTITUTION_BY_INTENT 含 5 个 intent 映射', () => {
    const keys = Object.keys(CONSTITUTION_BY_INTENT);
    assert(keys.length === 5);
    assert('query' in CONSTITUTION_BY_INTENT);
    assert('delete' in CONSTITUTION_BY_INTENT);
    assert('compare' in CONSTITUTION_BY_INTENT);
    assert('exit' in CONSTITUTION_BY_INTENT);
    assert('other' in CONSTITUTION_BY_INTENT);
    assert(Object.isFrozen(CONSTITUTION_BY_INTENT));
  });

  // 38. 意图识别宪法防抖规则
  test('intentRecognitionConstitution 含防抖规则', () => {
    const text = intentRecognitionConstitution();
    assert(text.includes('防抖'));
  });

  // 39. 意图识别宪法置信度路由
  test('intentRecognitionConstitution 含置信度路由规则', () => {
    const text = intentRecognitionConstitution();
    assert(text.includes('80'));
    assert(text.includes('60'));
  });

  // 40. queryConstitution 含 changeLevel 规则
  test('queryConstitution 含 changeLevel major/minor', () => {
    const text = queryConstitution();
    assert(text.includes('major'));
    assert(text.includes('minor'));
  });

  // 41. compareConstitution 返回完整宪法
  test('compareConstitution 含比对规则', () => {
    const text = compareConstitution();
    assert(text.includes('比对'));
    assert(text.includes('两个不同时间范围'));
  });

  // 42. deleteConstitution 含放弃规则
  test('deleteConstitution 含 giveup 规则', () => {
    const text = deleteConstitution();
    assert(text.includes('算了'));
    assert(text.includes('giveup'));
  });

  // ═══════════════════════════════════════════════════
  // 收尾
  // ═══════════════════════════════════════════════════

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
