// @MetaAgent v5.8 — outputs-manager.js
// 产出物 importance 管理：critical 强制写盘+审计追踪，high/normal 尽量写盘

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class OutputsManager {
  constructor(l3Path) {
    this._byIntent = new Map();
    try {
      const raw = readFileSync(join(l3Path, 'outputs.json'), 'utf-8');
      const data = JSON.parse(raw);
      for (const level of ['critical', 'high', 'normal']) {
        for (const entry of data[level]) {
          this._byIntent.set(entry.intent, { ...entry, level });
        }
      }
    } catch {
      // outputs.json 可能由 N12 逐步生成，允许缺失
    }
  }

  /** 查 intent 对应产出物的 importance */
  importanceOf(intent) {
    const e = this._byIntent.get(intent);
    return e ? e.level : 'normal';
  }

  /** 是否为 critical 产出物 */
  isCritical(intent) {
    return this.importanceOf(intent) === 'critical';
  }

  /** 获取产出物名称 */
  outputName(intent) {
    const e = this._byIntent.get(intent);
    return e ? e.output : `unknown-${intent}`;
  }

  /** 获取当前环节需要的所有产出物 intent 列表（用于房间落地检查） */
  getRequiredOutputs(intent) {
    // 返回当前 intent 自己——每个房间至少产出自己的 delivery
    const e = this._byIntent.get(intent);
    return e ? [intent] : [];
  }

  /** 获取所有已注册 intent */
  allIntents() {
    return Array.from(this._byIntent.keys());
  }
}
