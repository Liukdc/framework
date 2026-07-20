// @MetaAgent v5.8 — n14-toolchain/test-state-route.js
// 状态机 + 路由表 单元测试（约 30 条 case）
import { StateMachine, STATES } from '../src-v5.8/state-machine.js';
import { RouteTable } from '../src-v5.8/route-table.js';
import { join } from 'node:path';

const L3 = join(import.meta.dirname || '.', '..', 'l3-v5.8');

const sm = new StateMachine(L3);
const rt = new RouteTable(L3, sm);

let pass = 0, fail = 0;
function check(name, actual, expected, detail = '') {
  const ok = actual === expected || (expected instanceof RegExp && expected.test(actual));
  if (ok) { pass++; } else {
    fail++;
    console.error(`  ❌ ${name}: 期望=${expected} 实际=${actual} ${detail}`);
  }
}

// ═══════════════ StateMachine ═══════════════
console.log('\n── StateMachine ──');

// taskType 查询
check('P0 taskType', sm.getTaskType('P0'), 'topic_based');
check('N11 taskType', sm.getTaskType('N11'), 'field_based');
check('N12 taskType', sm.getTaskType('N12'), 'field_based');
check('domain-rule-session taskType', sm.getTaskType('domain-rule-session'), 'topic_based');
check('N2 taskType', sm.getTaskType('N2'), 'topic_based');

// importance
check('N1 importance', sm.getImportance('N1'), 'critical');
check('N11 importance', sm.getImportance('N11'), 'critical');
check('P0 importance', sm.getImportance('P0'), 'high');
check('N4 importance', sm.getImportance('N4'), 'normal');

// intent 数量（18 = P0 + N1~N15 + domain-rule-session + other）
check('intentList count', sm.intentList.length, 18);

// _matchFrom — 精确匹配
check('exact: ANALYZING=ANALYZING', sm._matchFrom('ANALYZING', 'ANALYZING'), true);
check('exact: IDLE vs LISTENING', sm._matchFrom('IDLE', 'LISTENING'), false);

// _matchFrom — IN_SESSION(topic) 通配 topic_based
check('topic: IN_SESSION(N3) match IN_SESSION(topic)', sm._matchFrom('IN_SESSION(N3)', 'IN_SESSION(topic)'), true);
check('topic: IN_SESSION(N10) match IN_SESSION(topic)', sm._matchFrom('IN_SESSION(N10)', 'IN_SESSION(topic)'), true);
check('topic: IN_SESSION(domain-rule-session) match IN_SESSION(topic)',
  sm._matchFrom('IN_SESSION(domain-rule-session)', 'IN_SESSION(topic)'), true);

// _matchFrom — IN_SESSION(field) 通配 field_based
check('field: IN_SESSION(N11) match IN_SESSION(field)', sm._matchFrom('IN_SESSION(N11)', 'IN_SESSION(field)'), true);
check('field: IN_SESSION(N12) match IN_SESSION(field)', sm._matchFrom('IN_SESSION(N12)', 'IN_SESSION(field)'), true);
check('field: IN_SESSION(P0) NOT match IN_SESSION(field)', sm._matchFrom('IN_SESSION(P0)', 'IN_SESSION(field)'), false);

// _matchFrom — IN_SESSION 万能通配
check('wildcard: IN_SESSION(N13) match IN_SESSION', sm._matchFrom('IN_SESSION(N13)', 'IN_SESSION'), true);
check('wildcard: IN_SESSION(N11) match IN_SESSION', sm._matchFrom('IN_SESSION(N11)', 'IN_SESSION'), true);

// transition — ANALYZING→IN_SESSION
check('trans: IDLE→LISTENING', sm.transition(STATES.LISTENING).to, 'LISTENING');
check('trans: LISTENING→ANALYZING', sm.transition(STATES.ANALYZING).to, 'ANALYZING');
sm.transition(STATES.IN_SESSION, 'P0', 'topic_based');
check('trans: ANALYZING→IN_SESSION(P0)', sm.fullState, 'IN_SESSION(P0)');

// 状态属性（重置到 IDLE）
sm.transition(STATES.IDLE);
check('IDLE is steady', sm.isSteady(), true);
check('IDLE NOT steadyContainer', sm.isSteadyContainer(), false);
sm.transition(STATES.IN_SESSION, 'P0');
check('IN_SESSION(P0) is steadyContainer', sm.isSteadyContainer(), true);

// ═══════════════ RouteTable ═══════════════
console.log('\n── RouteTable ──');

// 路由表条数
check('route count', rt._routes.length, 12);

// turnType=complete → LISTENING（topic_based）
const r1 = rt.match('IN_SESSION(P0)', 'turnType=complete');
check('route: P0 complete→LISTENING', r1 ? r1.to : null, 'LISTENING');
check('route: P0 topicEvolution', r1 ? r1.topicEvolutionEventAppended : null, true);

// turnType=complete → EXECUTING（field_based N11）
const r2 = rt.match('IN_SESSION(N11)', 'turnType=complete');
check('route: N11 complete→EXECUTING', r2 ? r2.to : null, 'EXECUTING');
check('route: N11 validationType', r2 ? r2.validationType : null, 'value_domain');

// turnType=off-task → ANALYZING
const r3 = rt.match('IN_SESSION(N7)', 'turnType=off-task');
check('route: N7 off-task→ANALYZING', r3 ? r3.to : null, 'ANALYZING');

// turnType=giveup → LISTENING
const r4 = rt.match('IN_SESSION(N15)', 'turnType=giveup');
check('route: N15 giveup→LISTENING', r4 ? r4.to : null, 'LISTENING');

// WAITING_CONFIRM
const r5 = rt.match('WAITING_CONFIRM', 'decision=confirm');
check('route: confirm→IN_SESSION', r5 ? r5.to : null, 'IN_SESSION');
const r6 = rt.match('WAITING_CONFIRM', 'decision=reject');
check('route: reject→ANALYZING', r6 ? r6.to : null, 'ANALYZING');

// N13 代码专项模型
const r7 = rt.match('ANALYZING', 'intent=N13');
check('route: N13→IN_SESSION(N13)', r7 ? r7.to : null, 'IN_SESSION(N13)');
const override = rt.getSecondLayerOverride('N13');
check('N13 modelOverride', override, '代码专项模型');

// N11,N12 逗号枚举匹配
const r8 = rt.match('ANALYZING', 'intent=N11');
check('route: N11→IN_SESSION', r8 ? r8.to : null, 'IN_SESSION');
const r9 = rt.match('ANALYZING', 'intent=N12');
check('route: N12→IN_SESSION', r9 ? r9.to : null, 'IN_SESSION');

// ANALYZING→IN_SESSION（domain-rule-session）
const r10 = rt.match('ANALYZING', 'intent=domain-rule-session');
check('route: domain-rule→IN_SESSION', r10 ? r10.to : null, 'IN_SESSION');

// 无匹配
check('no route: IDLE→complete', rt.match('IDLE', 'turnType=complete'), null);

// firstLayer model
check('firstLayer ANALYZING', rt.getFirstLayerModel('ANALYZING'), 'deepseek');
check('firstLayer IN_SESSION', rt.getFirstLayerModel('IN_SESSION'), 'deepseek');

// ═══════════════ 结果 ═══════════════
const total = pass + fail;
console.log(`\n${pass}/${total} 通过${fail > 0 ? ` (${fail} 失败)` : ' ✅'}`);
process.exit(fail > 0 ? 1 : 0);
