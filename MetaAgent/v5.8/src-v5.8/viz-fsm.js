// MetaAgent v5.8 — viz-fsm.js
// 状态机可视化：读取 L3 JSON，产出 Mermaid 流程图
// 用法: node viz-fsm.js --l3 ./l3-v5.8 > fsm.md

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const L3 = process.argv.includes('--l3')
  ? process.argv[process.argv.indexOf('--l3') + 1]
  : join(import.meta.dirname || '.', '..', 'l3-v5.8');

let boundary, states, transitions, routes;
try {
  boundary = JSON.parse(readFileSync(join(L3, 'boundary.json'), 'utf-8'));
  states   = JSON.parse(readFileSync(join(L3, 'states.json'),   'utf-8'));
  transitions = JSON.parse(readFileSync(join(L3, 'transitions.json'), 'utf-8'));
  routes      = JSON.parse(readFileSync(join(L3, 'routeTable.json'),   'utf-8'));
} catch (err) {
  console.error('L3 加载失败:', err.message);
  process.exit(1);
}

const intents = (boundary.doList || []).map(d => d.intent);
const subtypes = states.inSessionSubtypes || [];
const importance = {};
for (const s of subtypes) importance[s.intent] = s.importance || 'normal';

// ═══ Mermaid 状态图 ═══
console.log('# 状态机流程图\n');
console.log('```mermaid');
console.log('stateDiagram-v2');

// 基础状态
const baseStates = ['IDLE', 'LISTENING', 'ANALYZING'];
for (const s of baseStates) console.log(`    ${s}`);

// IN_SESSION 子状态
console.log('    state IN_SESSION {');
for (const s of subtypes) {
  const icon = s.taskType === 'field_based' ? '📋' : '💬';
  const imp  = s.importance === 'critical' ? '⚠' : '';
  console.log(`        ${s.intent} : ${icon} ${s.intent} ${imp} (${s.taskType})`);
}
console.log('    }');

// 转移边
for (const t of transitions) {
  const trig = Array.isArray(t.trigger) ? t.trigger.join('/') : t.trigger;
  console.log(`    ${t.from} --> ${t.to} : ${trig}`);
}

console.log('```\n');

// ═══ 文本版转移矩阵 ═══
console.log('## 路由表\n');
console.log('| 从 | 条件 | 到 |');
console.log('|---|---|---|');
for (const r of routes.routes || []) {
  console.log(`| ${r.from} | ${r.contractOutKey} | ${r.to} |`);
}

// ═══ 完整性检查 ═══
console.log('\n## 完整性检查\n');
const issues = [];
if (transitions.length < 8) issues.push(`⚠️ 转移边: ${transitions.length} (建议 ≥8)`);
if ((routes.routes || []).length < 8) issues.push(`⚠️ 路由: ${(routes.routes || []).length} 条 (建议 ≥8)`);
const criticalCount = subtypes.filter(s => s.importance === 'critical').length;
if (criticalCount === 0) issues.push('⚠️ 无 critical 节点');
const fieldCount = subtypes.filter(s => s.taskType === 'field_based').length;
if (fieldCount === 0) issues.push('⚠️ 无 field_based 节点');

if (issues.length === 0) {
  console.log('✅ 基本检查通过');
} else {
  for (const i of issues) console.log(i);
}

// ═══ 意图覆盖 ═══
console.log('\n## 意图覆盖\n');
for (const intent of intents) {
  const rt = (routes.routes || []).filter(r => r.contractOutKey.includes(intent));
  const tt = transitions.filter(t => {
    const trig = Array.isArray(t.trigger) ? t.trigger.join(' ') : t.trigger;
    return trig.includes(intent);
  });
  console.log(`| **${intent}** | 路由 ${rt.length} 条 | 转移 ${tt.length} 条 | ${importance[intent] || 'normal'} |`);
}
