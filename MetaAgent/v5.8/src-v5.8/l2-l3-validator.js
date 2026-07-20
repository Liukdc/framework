// @MetaAgent v5.8 — l2-l3-validator.js
// L2→L3 语义一致性校验：intent 数、taskType 分布、转移边完整性、importance 标记

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class L2L3Validator {
  constructor(l3Path) {
    this._l3Path = l3Path;
  }

  async validate() {
    const results = [];
    const load = (name) => JSON.parse(readFileSync(join(this._l3Path, name), 'utf-8'));

    // 1. intent 数量一致性：boundary.doList 与 states.inSessionSubtypes 对齐
    const doCount = boundary.doList.length;
    const subCount = states.inSessionSubtypes.length;
    results.push({
      check: 'intent-count-consistency',
      pass: doCount === subCount,
      detail: `boundary=${doCount}, states=${subCount}, ${doCount === subCount ? '一致' : '不一致!'}`,
    });

    // 2. taskType 分布：从 boundary 自统计
    const topicCount = boundary.doList.filter(i => i.taskType === 'topic_based').length;
    const fieldCount = boundary.doList.filter(i => i.taskType === 'field_based').length;
    const totalFromDoList = topicCount + fieldCount;
    results.push({
      check: 'taskType-distribution',
      pass: totalFromDoList === doCount && fieldCount > 0,
      detail: `topic_based=${topicCount}, field_based=${fieldCount}, 总计=${totalFromDoList}/${doCount}`,
    });

    // 3. 转移边数量：>= 8（最小骨架: 8状态各至少1条出口）
    const transitions = load('transitions.json');
    results.push({
      check: 'transition-count',
      pass: transitions.length >= 8,
      detail: `transitions=${transitions.length} (最小8)`,
    });

    // 4. 路由表覆盖
    const rt = load('routeTable.json');
    results.push({
      check: 'route-count',
      pass: rt.routes.length >= subCount,
      detail: `routes=${rt.routes.length}, subtypes=${subCount}`,
    });

    // 5. importance 标记（关键产出物至少 2 个）
    const criticalSubtypes = states.inSessionSubtypes.filter(s => s.importance === 'critical');
    const highSubtypes = states.inSessionSubtypes.filter(s => s.importance === 'high');
    results.push({
      check: 'importance-tags',
      pass: criticalSubtypes.length >= 2,
      detail: `critical=${criticalSubtypes.length}个, high=${highSubtypes.length}个`,
    });

    // 6. outputs.json 存在
    results.push({
      check: 'outputs-json',
      pass: existsSync(join(this._l3Path, 'outputs.json')),
      detail: 'outputs.json exists',
    });

    // 7. field_based intent: taskType=field_based 且 topicEvolutionEnabled=false
    const fieldIntents = states.inSessionSubtypes.filter(s => s.taskType === 'field_based');
    const fieldConfigOk = fieldIntents.every(s => s.topicEvolutionEnabled === false);
    results.push({
      check: 'field_based-config',
      pass: fieldIntents.length > 0 && fieldConfigOk,
      detail: `field_based intent=${fieldIntents.map(s => s.intent).join(',')}, topicEv=${fieldConfigOk ? 'disabled✓' : 'enabled✗'}`,
    });

    const allPass = results.every(r => r.pass);
    return { allPass, results };
  }
}

/** 快速校验（CLI模式） */
export async function quickValidate(l3Path) {
  const validator = new L2L3Validator(l3Path);
  const { allPass, results } = await validator.validate();
  if (!allPass) {
    const failures = results.filter(r => !r.pass);
    console.error('[l2-l3-validator] FAIL:', failures.map(f => `${f.check}=${f.detail}`).join('; '));
  }
  return { allPass, results };
}
