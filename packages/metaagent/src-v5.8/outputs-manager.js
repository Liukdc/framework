// @MetaAgent v5.8 — outputs-manager.js
// 产出物 importance 管理：critical 强制写盘+审计追踪，high/normal 尽量写盘

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class OutputsManager {
  constructor(l3Path) {
    const raw = readFileSync(join(l3Path, 'outputs.json'), 'utf-8');
    const data = JSON.parse(raw);
    this._byIntent = new Map();
    for (const level of ['critical', 'high', 'normal']) {
      for (const entry of data[level]) {
        this._byIntent.set(entry.intent, { ...entry, level });
      }
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

  /** 获取写盘策略 */
  strategyFor(intent) {
    const e = this._byIntent.get(intent);
    if (!e) return 'write'; // 默认尽量写盘
    return e.level === 'critical' ? 'forcedWrite' : 'write';
  }

  /** 获取产出物名称 */
  outputName(intent) {
    const e = this._byIntent.get(intent);
    return e ? e.output : `unknown-${intent}`;
  }
}
