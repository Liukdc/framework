// @MetaAgent v5.8 — l2-l3-validator.js
// L2→L3 语义一致性校验：容错模式，缺文件不崩
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class L2L3Validator {
  constructor(l3Path) {
    this._l3Path = l3Path;
  }

  async validate() {
    const results = [];
    const load = (name) => {
      const p = join(this._l3Path, name);
      if (!existsSync(p)) return null;
      try { return JSON.parse(readFileSync(p, 'utf-8')); }
      catch { return null; }
    };

    const boundary = load('boundary.json');
    const states = load('states.json');
    const transitions = load('transitions.json');
    const rt = load('routeTable.json');

    // 报告缺失文件
    for (const [name, val] of Object.entries({boundary, states, transitions, routeTable: rt})) {
      if (!val) results.push({
        check: `${name === 'routeTable' ? 'routeTable' : name}.json`,
        pass: false,
        detail: `缺失或解析失败`,
      });
    }
    if (results.some(r => !r.pass)) {
      return { allPass: false, results };
    }

    // 1. intent 数量一致性
    const doCount = boundary.doList?.length || 0;
    const subCount = states.inSessionSubtypes?.length || 0;
    results.push({
      check: 'intent-count-consistency',
      pass: doCount > 0 && doCount === subCount,
      detail: `boundary=${doCount}, states=${subCount}`,
    });

    // 2. taskType 分布
    const topicCount = (boundary.doList || []).filter(i => i.taskType === 'topic_based').length;
    const fieldCount = (boundary.doList || []).filter(i => i.taskType === 'field_based').length;
    results.push({
      check: 'taskType-distribution',
      pass: (topicCount + fieldCount) === doCount && fieldCount > 0,
      detail: `topic_based=${topicCount}, field_based=${fieldCount}`,
    });

    // 3. 转移边
    results.push({
      check: 'transition-count',
      pass: Array.isArray(transitions) && transitions.length >= 8,
      detail: `transitions=${Array.isArray(transitions) ? transitions.length : 'NaN'} (最小8)`,
    });

    // 4. 路由表
    const routes = Array.isArray(rt?.routes) ? rt.routes : (Array.isArray(rt) ? rt : []);
    results.push({
      check: 'route-count',
      pass: routes.length >= 8,
      detail: `routes=${routes.length} (最小8)`,
    });

    // 5. importance
    const subtypes = states.inSessionSubtypes || [];
    const criticalSubtypes = subtypes.filter(s => s.importance === 'critical');
    results.push({
      check: 'importance-tags',
      pass: criticalSubtypes.length >= 2,
      detail: `critical=${criticalSubtypes.length}个`,
    });

    // 6. outputs.json
    results.push({
      check: 'outputs-json',
      pass: existsSync(join(this._l3Path, 'outputs.json')),
      detail: 'outputs.json exists',
    });

    // 7. field_based 配置
    const fieldIntents = subtypes.filter(s => s.taskType === 'field_based');
    results.push({
      check: 'field_based-config',
      pass: fieldIntents.length > 0 && fieldIntents.every(s => s.topicEvolutionEnabled === false),
      detail: `field_based=${fieldIntents.map(s => s.intent).join(',')}`,
    });

    const allPass = results.every(r => r.pass);
    return { allPass, results };
  }
}

export async function quickValidate(l3Path) {
  const validator = new L2L3Validator(l3Path);
  const { allPass, results } = await validator.validate();
  if (!allPass) {
    const failures = results.filter(r => !r.pass);
    console.warn('[l2-l3-validator]', failures.map(f => `${f.check}: ${f.detail}`).join(' | '));
  }
  return { allPass, results };
}
