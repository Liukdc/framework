// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * v4.0 turnType + tunables 测试套件
 *
 * 运行方式: node test-v40-turnType-tunables.js
 * 覆盖模块: turnType.js, tunables.js
 */

import {
  TurnType, ChangeLevel, AskingField,
  isValidTurnType, isValidChangeLevel, isValidAskingField,
  validateTurn, createTurn,
} from './src/turnType.js';

import {
  getTunable, setTunable, resetTunables,
  getTunableDefs, getTunableSnapshot, detectConflicts,
} from './src/tunables.js';

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
  console.log(`# v4.0 turnType + tunables 测试 — ${new Date().toISOString()}\n`);

  // ═══════════════════════════════════════════════════
  // 第一部分: turnType.js
  // ═══════════════════════════════════════════════════
  console.log('# ── turnType.js ──');

  // 1. TurnType 枚举 6 个值完整
  test('TurnType 枚举 6 个值完整', () => {
    const values = Object.values(TurnType);
    assert(values.length === 6, `Expected 6, got ${values.length}`);
    assert(values.includes('ask'));
    assert(values.includes('reply'));
    assert(values.includes('complete'));
    assert(values.includes('off-task'));
    assert(values.includes('giveup'));
    assert(values.includes('validation_failed'));
    assert(Object.isFrozen(TurnType), 'TurnType should be frozen');
  });

  // 2. ChangeLevel 枚举 3 个值完整
  test('ChangeLevel 枚举 3 个值完整', () => {
    const values = Object.values(ChangeLevel);
    assert(values.length === 3, `Expected 3, got ${values.length}`);
    assert(values.includes('major'));
    assert(values.includes('minor'));
    assert(values.includes('invalid'));
    assert(Object.isFrozen(ChangeLevel), 'ChangeLevel should be frozen');
  });

  // 3. AskingField 枚举值完整
  test('AskingField 枚举值完整', () => {
    const values = Object.values(AskingField);
    assert(values.includes('category'));
    assert(values.includes('amount'));
    assert(values.includes('time'));
    assert(values.includes('quantity'));
    assert(Object.isFrozen(AskingField), 'AskingField should be frozen');
  });

  // 4. isValidTurnType 各值
  test('isValidTurnType("ask") → true', () => {
    assert(isValidTurnType('ask') === true);
  });
  test('isValidTurnType("xyz") → false', () => {
    assert(isValidTurnType('xyz') === false);
  });
  test('isValidChangeLevel(null) → true', () => {
    assert(isValidChangeLevel(null) === true);
  });
  test('isValidAskingField("amount") → true', () => {
    assert(isValidAskingField('amount') === true);
  });

  // 5. validateTurn(validTurn) → {valid:true}
  test('validateTurn 有效 turn → {valid:true}', () => {
    const r = validateTurn({ turnType: 'ask', message: '多少钱？' });
    assert(r.valid === true, `Expected valid=true, got ${JSON.stringify(r)}`);
    assert(r.errors.length === 0);
  });

  // 6. validateTurn 缺 turnType → {valid:false}
  test('validateTurn 缺 turnType → {valid:false}', () => {
    const r = validateTurn({ message: 'hello' });
    assert(r.valid === false);
    assert(r.errors.length >= 1);
    assert(r.errors.some(e => e.includes('turnType')));
  });

  // 7. validateTurn changeLevelReason 超100字 → {valid:false}
  test('validateTurn changeLevelReason 超100字 → {valid:false}', () => {
    const r = validateTurn({
      turnType: 'ask',
      changeLevel: 'major',
      changeLevelReason: 'x'.repeat(101),
    });
    assert(r.valid === false);
    assert(r.errors.some(e => e.includes('changeLevelReason')));
  });

  // 8. validateTurn message 超30字
  test('validateTurn message 超30字 → 报错', () => {
    const r = validateTurn({
      turnType: 'reply',
      message: '这是一条超过了三十个字限制的非常长的消息文本内容测试一二三四五六七八九十',
    });
    assert(r.valid === false);
    assert(r.errors.some(e => e.includes('message')));
  });

  // 9. validateTurn turnType=validation_failed 缺 validationResult
  test('validateTurn validation_failed 缺 validationResult → {valid:false}', () => {
    const r = validateTurn({ turnType: 'validation_failed' });
    assert(r.valid === false);
    assert(r.errors.some(e => e.includes('validationResult')));
  });

  // 10. validateTurn turnType=off-task 缺 offTaskInput
  test('validateTurn off-task 缺 offTaskInput → {valid:false}', () => {
    const r = validateTurn({ turnType: 'off-task' });
    assert(r.valid === false);
    assert(r.errors.some(e => e.includes('offTaskInput')));
  });

  // 11. validateTurn 无效 changeLevel
  test('validateTurn 无效 changeLevel → {valid:false}', () => {
    const r = validateTurn({ turnType: 'ask', changeLevel: 'extreme' });
    assert(r.valid === false);
    assert(r.errors.some(e => e.includes('changeLevel')));
  });

  // 12. createTurn 返回正确结构
  test('createTurn 返回正确结构', () => {
    const turn = createTurn({ turnType: 'ask', message: '多少钱？' });
    assert(turn.turnType === 'ask');
    assert(turn.message === '多少钱？');
    assert(turn.askingField === null);
    assert(turn.changeLevel === null);
    assert(turn.changeLevelReason === null);
    assert(turn.validationResult === null);
    assert(typeof turn.collectedFields === 'object');
    assert(turn.offTaskInput === null);
    assert(turn.result === null);
    assert(Object.isFrozen(turn), 'createTurn should return frozen object');
  });

  // 13. createTurn 默认值填充
  test('createTurn 默认值填充', () => {
    const turn = createTurn({ turnType: 'reply' });
    assert(turn.message === '');
    assert(turn.collectedFields !== null);
  });

  // 14. validateTurn 空/null 对象
  test('validateTurn null → {valid:false}', () => {
    const r = validateTurn(null);
    assert(r.valid === false);
  });

  // 15. validateTurn 完整 validation_failed turn
  test('validateTurn 完整 validation_failed turn → {valid:true}', () => {
    const r = validateTurn({
      turnType: 'validation_failed',
      validationResult: { field: 'amount', issue: 'amount_invalid', userInput: '0' },
    });
    assert(r.valid === true);
  });

  // ═══════════════════════════════════════════════════
  // 第二部分: tunables.js
  // ═══════════════════════════════════════════════════
  console.log('\n# ── tunables.js ──');

  // 重置覆盖值（确保测试清洁）
  resetTunables();

  // 16. getTunable 默认 confidence_threshold=0.4
  test('getTunable confidence_threshold → 0.4', () => {
    assert(getTunable('confidence_threshold') === 0.4);
  });

  // 17. getTunable 默认 turnHistory_limit=20
  test('getTunable turnHistory_limit → 20', () => {
    assert(getTunable('turnHistory_limit') === 20);
  });

  // 18. getTunable 不存在 key → throw Error
  test('getTunable 不存在 key → throw Error', () => {
    let threw = false;
    try {
      getTunable('nonexistent_key');
    } catch (e) {
      threw = true;
      assert(e.message.includes('Unknown tunable'));
    }
    assert(threw, 'Should throw for unknown key');
  });

  // 19. getTunable amount_limit_max=999999
  test('getTunable amount_limit_max → 999999', () => {
    assert(getTunable('amount_limit_max') === 999999);
  });

  // 20. setTunable 正常覆盖
  test('setTunable 正常覆盖 confidence_threshold=0.6', () => {
    setTunable('confidence_threshold', 0.6);
    assert(getTunable('confidence_threshold') === 0.6);
    resetTunables();
    assert(getTunable('confidence_threshold') === 0.4);
  });

  // 21. setTunable 超范围 → throw Error 并保持原值
  test('setTunable 超范围 → throw Error 并保持原值', () => {
    const orig = getTunable('confidence_threshold');
    let threw = false;
    try {
      setTunable('confidence_threshold', 1.5);
    } catch (e) {
      threw = true;
      assert(e.message.includes('out of range'));
    }
    assert(threw, 'Should throw for out-of-range value');
    assert(getTunable('confidence_threshold') === orig, 'Value should remain unchanged');
  });

  // 22. detectConflicts 无冲突时返回空数组
  test('detectConflicts 无冲突时返回空数组', () => {
    resetTunables();
    const result = detectConflicts();
    assert(Array.isArray(result.conflicts));
    assert(result.conflicts.length === 0, `Expected 0 conflicts, got ${result.conflicts.length}`);
  });

  // 23. getTunable critical_room_history_boost=2.0
  test('getTunable critical_room_history_boost → 2.0', () => {
    assert(getTunable('critical_room_history_boost') === 2.0);
  });

  // 24. getTunable pending_fields_ttl
  test('getTunable pending_fields_ttl → "24h"', () => {
    assert(getTunable('pending_fields_ttl') === 86400);
  });

  // 25. setTunable 数值范围参数边界
  test('setTunable pid_kp=0.01 (min边界) → 成功', () => {
    setTunable('pid_kp', 0.01);
    assert(getTunable('pid_kp') === 0.01);
    resetTunables();
  });

  // 26. setTunable 字符串范围参数超界
  test('setTunable pending_fields_ttl="0h" → throw', () => {
    let threw = false;
    try {
      setTunable('pending_fields_ttl', '0h');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Should throw for out-of-range string value');
  });

  // 27. boundary_coverage_threshold=0.85
  test('getTunable boundary_coverage_threshold → 0.85', () => {
    assert(getTunable('boundary_coverage_threshold') === 0.85);
  });

  // 28. cold_start_observation_window=50
  test('getTunable cold_start_observation_window → 50', () => {
    assert(getTunable('cold_start_observation_window') === 50);
  });

  // 29. cross-param 冲突检测：高负载触发预算超限
  test('detectConflicts 高负载 cross-param 触发预算告警', () => {
    resetTunables();
    // turnHistory_limit=100, critical_room_history_boost=5.0, max_critical_rooms=10
    // 10*100*5.0*200 = 1,000,000 > 128000*0.6=76800 → conflict
    const result = detectConflicts({
      turnHistory_limit: 100,
      critical_room_history_boost: 5.0,
      max_critical_rooms: 10,
    });
    const crossConflicts = result.conflicts.filter(c => c.rule === 'critical_room_context_budget_check');
    assert(crossConflicts.length > 0, 'Should detect cross-param budget conflict');
  });

  // 30. getTunableDefs 返回不可变对象
  test('getTunableDefs 返回含14个参数的定义', () => {
    const defs = getTunableDefs();
    const keys = Object.keys(defs);
    assert(keys.length === 14, `Expected 14 params, got ${keys.length}`);
    assert('amount_limit_max' in defs);
    assert('session_checkpoint_ttl' in defs);
  });

  // 31. getTunableSnapshot 返回完整快照
  test('getTunableSnapshot 返回完整快照', () => {
    resetTunables();
    const snap = getTunableSnapshot();
    assert(Object.keys(snap).length === 14);
    assert(snap.confidence_threshold === 0.4);
    assert(snap.turnHistory_limit === 20);
  });

  // 32. setTunable max_critical_rooms 范围
  test('setTunable max_critical_rooms=5 → 成功', () => {
    setTunable('max_critical_rooms', 5);
    assert(getTunable('max_critical_rooms') === 5);
    resetTunables();
  });

  // 33. setTunable max_critical_rooms=0 → throw (range 1-10)
  test('setTunable max_critical_rooms=0 → throw (range 1-10)', () => {
    let threw = false;
    try {
      setTunable('max_critical_rooms', 0);
    } catch (e) {
      threw = true;
    }
    assert(threw);
  });

  // 34. strengthens_weight_cap=3
  test('getTunable strengthens_weight_cap → 3', () => {
    assert(getTunable('strengthens_weight_cap') === 3);
  });

  // 35. session_checkpoint_ttl=604800 (7天)
  test('getTunable session_checkpoint_ttl → 604800', () => {
    assert(getTunable('session_checkpoint_ttl') === 604800);
  });

  // ═══════════════════════════════════════════════════
  // 收尾
  // ═══════════════════════════════════════════════════

  resetTunables();

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
