// @MetaAgent v5.8 — route-table.js
// 路由匹配器：按 contractOutKey 匹配目标状态

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class RouteTable {
  constructor(l3Path, stateMachine) {
    const raw = readFileSync(join(l3Path, 'routeTable.json'), 'utf-8');
    const data = JSON.parse(raw);
    this._firstLayer = data.firstLayer;
    this._secondLayer = data.secondLayer;
    this._routes = data.routes;
    this._sm = stateMachine;
  }

  /** 按 from + contractOutKey 匹配路由 */
  match(from, contractOutKey) {
    for (const route of this._routes) {
      if (!this._matchFrom(from, route.from)) continue;
      if (!this._matchKey(contractOutKey, route.contractOutKey)) continue;
      return { ...route };
    }
    return null;
  }

  /** 模糊匹配 from（从 L3 states 取 taskType，不硬编码 N11/N12） */
  _matchFrom(actualFrom, patternFrom) {
    if (actualFrom === patternFrom) return true;
    if (patternFrom.startsWith('IN_SESSION(') && actualFrom.startsWith('IN_SESSION(')) {
      const patternType = patternFrom.match(/IN_SESSION\(([\w,-]+)/)?.[1];
      const actualIntent = actualFrom.match(/IN_SESSION\(([\w,-]+)/)?.[1];
      if (patternType && actualIntent) {
        // 逗号分隔 → 枚举值绑定 (e.g. N11,N12)
        if (patternType.includes(',')) {
          const set = new Set(patternType.split(','));
          return set.has(actualIntent);
        }
        // topic/field → 按 taskType 通配
        const taskType = this._sm?.getTaskType(actualIntent);
        if (patternType === 'topic' && taskType === 'topic_based') return true;
        if (patternType === 'field' && taskType === 'field_based') return true;
      }
    }
    if (patternFrom === 'IN_SESSION' && actualFrom.startsWith('IN_SESSION(')) return true;
    return false;
  }

  /** 模糊匹配 contractOutKey */
  _matchKey(actualKey, patternKey) {
    if (actualKey === patternKey) return true;
    // intent=P0~N10 匹配 intent 在 P0-N10 范围内
    if (patternKey === 'intent=P0~N10') {
      const match = actualKey.match(/intent=(\w+)/);
      if (!match) return false;
      const intents = ['P0','N1','N2','N3','N4','N5','N6','N7','N8','N9','N10'];
      return intents.includes(match[1]);
    }
    // intent=N11,N12
    if (patternKey === 'intent=N11,N12') {
      return actualKey === 'intent=N11' || actualKey === 'intent=N12';
    }
    // intent=N14~N15
    if (patternKey === 'intent=N14~N15') {
      return actualKey === 'intent=N14' || actualKey === 'intent=N15';
    }
    return false;
  }

  /** 获取第一层模型配置 */
  getFirstLayerModel(state) {
    if (state === 'ANALYZING') return this._firstLayer.analyzingModel;
    return this._firstLayer.inSessionModel;
  }

  /** 获取第二层模型覆盖 */
  getSecondLayerOverride(intent) {
    for (const binding of this._secondLayer) {
      if (binding.bindingKey === `intent=${intent}`) {
        return binding.modelOverride;
      }
    }
    return null;
  }

  /** 获取 to 状态标记（含 topicEvolution 等） */
  getToStateInfo(from, contractOutKey) {
    const matched = this.match(from, contractOutKey);
    if (!matched) return null;
    return {
      to: matched.to,
      topicEvolutionEventAppended: matched.topicEvolutionEventAppended,
      validationType: matched.validationType || null,
      modelHint: matched.modelHint || null,
      modelOverride: matched.modelOverride || null,
    };
  }
}
