// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 v5.8 — 主入口
 *
 * 10状态调度器 + 五层过滤 + tool calling + S3 + v5.7分段保留 + v5.8 conversationArchive
 *
 * @module fugui-xiaoan
 */

import { StateMachine } from './state-machine.js';
import { InMemoryContractStore } from './contract-store.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextManager } from './context-manager.js';
import { TelemetryCollector, NullTelemetryCollector } from './telemetry.js';
import { getConstitutionPrompt, validateAllConstitutions, getToolsForIntent } from './constitution-sessions.js';
import { getTunable, getDefaults, incrementSession } from './tunables.js';
import { runStaticChecks, formatReport as formatStatic } from '../n14-toolchain/static-checker.js';
import { runL2L3Check, formatL2L3Report } from './l3-consistency-checker.js';
import { runConflictCheck, formatConflictReport } from './conflict-detector.js';

export class FuguiXiaoan {
  constructor({ llmClient, store, telemetry } = {}) {
    this.llm = llmClient;
    this.store = store || new InMemoryContractStore();
    this.telemetry = telemetry || new NullTelemetryCollector();
    this.sm = new StateMachine({
      llmClient: this.llm,
      contractStore: this.store,
      telemetry: this.telemetry,
    });
    this._initDone = false;
  }

  /** 初始化: 宪法验证 + 冷启动计数 */
  async init() {
    const vResult = validateAllConstitutions();
    if (!vResult.passed) {
      console.warn('[富贵小安] 宪法验证警告:', vResult.violations.join(', '));
    }

    const l2l3 = runL2L3Check();
    if (!l2l3.allPassed) {
      console.warn('[富贵小安] L2→L3一致性警告:', l2l3.l3Missing.join(', '));
    }

    incrementSession();
    this._initDone = true;
    return { constitutionValid: vResult.passed, l2l3Consistent: l2l3.allPassed };
  }

  /** 主入口: 处理用户输入 */
  async handle(input) {
    if (!this._initDone) await this.init();
    return this.sm.handle(input);
  }

  /** 获取当前状态 */
  get state() { return this.sm.state; }

  /** 获取记账记录 */
  getRecords() { return this.store._records || []; }

  /** 搜索对话归档 */
  searchArchive(query) { return this.store.searchArchive(query); }

  /** 获取统计 */
  getStats() {
    const records = this.store._records || [];
    const total = records.reduce((s, r) => s + r.amount, 0);
    return {
      totalRecords: records.length,
      totalAmount: total,
      coldStart: this.store.getSessionIndex() < getTunable('cold_start_observation_window', 50),
      telemetry: this.telemetry.getMetrics(),
    };
  }

  /** N14 静态质量检查 */
  static runQualityCheck() {
    const result = runStaticChecks();
    console.log(formatStatic(result));
    return result;
  }

  /** N12 L2→L3 语义一致性检查 */
  static runL2L3Check() {
    const result = runL2L3Check();
    console.log(formatL2L3Report(result));
    return result;
  }

  /** 获取环节宪法 prompt */
  static getConstitution(intent) {
    return getConstitutionPrompt(intent);
  }

  /** 获取工具分配 */
  static getTools(intent) {
    return getToolsForIntent(intent);
  }

  /** tunable 参数 */
  static getTunable(name, fallback) {
    return getTunable(name, fallback);
  }

  static getTunableDefaults() {
    return getDefaults();
  }
}

// ═══ 便捷工厂 ═══════════════════════════════
export function createFuguiXiaoan({ llmClient, store, telemetry } = {}) {
  return new FuguiXiaoan({ llmClient, store, telemetry });
}
