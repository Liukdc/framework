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

    // 1. intent 数量一致性 (17)
    const boundary = load('boundary.json');
    const states = load('states.json');
    const doCount = boundary.doList.length;
    const subCount = states.inSessionSubtypes.length;
    results.push({
      check: 'intent-count',
      pass: doCount === subCount && doCount === 17,
      detail: `boundary=${doCount}, states=${subCount}, expected=17`,
    });

    // 2. taskType 分布 (14 topic + 2 field + 1 other)
    const topicCount = boundary.doList.filter(i => i.taskType === 'topic_based').length;
    const fieldCount = boundary.doList.filter(i => i.taskType === 'field_based').length;
    results.push({
      check: 'taskType-distribution',
      pass: topicCount === 15 && fieldCount === 2,
      detail: `topic_based=${topicCount}, field_based=${fieldCount}, expected topic=15 field=2`,
    });

    // 3. 转移边数量 (21)
    const transitions = load('transitions.json');
    results.push({
      check: 'transition-count',
      pass: transitions.length === 20,  // 18 + N11/N12 独立两条
      detail: `transitions=${transitions.length}, expected=20`,
    });

    // 4. 路由表覆盖
    const rt = load('routeTable.json');
    results.push({
      check: 'route-count',
      pass: rt.routes.length === 11,
      detail: `routes=${rt.routes.length}, expected=11`,
    });

    // 5. importance 标记
    const criticalSubtypes = states.inSessionSubtypes.filter(s => s.importance === 'critical');
    const highSubtypes = states.inSessionSubtypes.filter(s => s.importance === 'high');
    results.push({
      check: 'importance-tags',
      pass: criticalSubtypes.length >= 2 && highSubtypes.length >= 4,
      detail: `critical=${criticalSubtypes.length} (N1+N11), high=${highSubtypes.length} (P0+N3+N7+N9+N13)`,
    });

    // 6. outputs.json 存在
    results.push({
      check: 'outputs-json',
      pass: existsSync(join(this._l3Path, 'outputs.json')),
      detail: 'outputs.json exists',
    });

    // 7. N11/N12 field_based + topicEvolutionEnabled=false
    const n11 = states.inSessionSubtypes.find(s => s.intent === 'N11');
    const n12 = states.inSessionSubtypes.find(s => s.intent === 'N12');
    results.push({
      check: 'field_based-config',
      pass: n11 && n12 && n11.taskType === 'field_based' && n12.taskType === 'field_based'
            && n11.topicEvolutionEnabled === false && n12.topicEvolutionEnabled === false,
      detail: `N11(field, topicEv=${n11?.topicEvolutionEnabled}), N12(field, topicEv=${n12?.topicEvolutionEnabled})`,
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
