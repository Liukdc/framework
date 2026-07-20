// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 上下文管理器 — 富贵小安 v5.8
 *
 * 三层确定性职责:
 *   Layer 1 匹配层: 规则子图匹配 + 冲突检测 + 条件检查
 *   Layer 2 决策层: 按 importance/strengths 权重决定注入内容
 *   Layer 3 拼接层: 组装 prompt + token 预算分配 + 截断
 *
 * v5.7: 分段保留拼接(优先全量对话→critical摘要→high→normal)
 * v5.5: 工具分层注入(必用完整定义+选用轻量目录+search_tools)
 *
 * @module fugui-xiaoan/context-manager-v5.8
 */

import { getTunable } from './tunables.js';

export class ContextManager {
  constructor({ contractStore }) {
    this.contractStore = contractStore;
  }

  /**
   * buildPromptContext — 匹配→决策→拼接三层顺序执行
   */
  async buildPromptContext({ turnHistory, currentAskField, currentTaskType, currentStepName, contractStore }) {
    const cs = contractStore || this.contractStore;

    // ═══ Layer 1: 匹配层 ═══════════════════
    const matched = this._matchLayer(currentStepName, currentTaskType, cs);

    // ═══ Layer 2: 决策层 ═══════════════════
    const decided = this._decisionLayer(matched, turnHistory, currentAskField, cs);

    // ═══ Layer 3: 拼接层 ═══════════════════
    return this._assemblyLayer(decided, currentTaskType, currentAskField);
  }

  // ═══ 匹配层: 规则子图匹配 ═══════════════════
  _matchLayer(stepName, taskType, contractStore) {
    const rules = (contractStore._domainRules || [])
      .filter(r => r.stepName === stepName || !r.stepName)
      .filter(r => r.status === 'active');

    // 冲突检测
    const conflicts = [];
    for (const r of rules) {
      if (r.edges?.conflicts_with) {
        for (const cid of r.edges.conflicts_with) {
          const conflict = rules.find(r2 => r2.ruleId === cid);
          if (conflict) conflicts.push({ ruleA: r.ruleId, ruleB: conflict.ruleId });
        }
      }
    }

    // 条件检查
    const conditionsMet = rules.filter(r => {
      if (!r.conditions) return true;
      return Object.entries(r.conditions).every(([k, v]) => true); // 简化: 生产环境需实际检查
    });

    return { rules: conditionsMet, conflicts, taskType };
  }

  // ═══ 决策层: 按 importance 排序 ═══════════
  _decisionLayer(matched, turnHistory, currentAskField, contractStore) {
    // 领域规则排序
    const iOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const sortedRules = [...matched.rules].sort((a, b) => {
      const ia = iOrder[a.importance] ?? 2;
      const ib = iOrder[b.importance] ?? 2;
      if (ia !== ib) return ia - ib;
      const sa = a._strengthensWeight || 0;
      const sb = b._strengthensWeight || 0;
      return sb - sa;
    });

    // v5.7: 分段保留对话
    const injectionLimits = {
      full: getTunable('turnHistory_limit', 20),
      critical: getTunable('summary_retention_critical', 10),
      high: getTunable('summary_retention_high', 5),
      normal: getTunable('summary_retention_normal', 2),
    };

    // 字段级硬门控: 保护与 askingField 同名的历史轮次
    const protectedTurns = currentAskField
      ? (turnHistory || []).filter(t => t.askingField === currentAskField)
      : [];

    const regularTurns = currentAskField
      ? (turnHistory || []).filter(t => t.askingField !== currentAskField)
      : (turnHistory || []);

    // 取最近的全量对话
    const recentFull = regularTurns.slice(-injectionLimits.full);

    return {
      rules: sortedRules,
      recentFull,
      protectedTurns,
      summaries: contractStore?.getConversationForInjection?.('default', injectionLimits.critical) || { full: [], summaries: [] },
      conflicts: matched.conflicts,
    };
  }

  // ═══ 拼接层: 组装 prompt ═══════════════════
  _assemblyLayer(decided, taskType, currentAskField) {
    const messages = [];

    // 1. 领域规则(最高优先级)
    if (decided.rules.length > 0) {
      messages.push({
        role: 'system',
        content: `[领域规则]\n${decided.rules.map(r => `- ${r.content || r.rule}`).join('\n')}`,
      });
    }

    // 2. 规则冲突处理
    if (decided.conflicts.length > 0) {
      messages.push({
        role: 'system',
        content: `[规则冲突] 以下规则互斥，请用户选择:\n${decided.conflicts.map(c => `- ${c.ruleA} vs ${c.ruleB}`).join('\n')}`,
      });
    }

    // 3. v5.7: 摘要注入(按重要性)
    const { full, summaries } = decided.summaries;
    const orderedSummaries = (summaries || []).sort((a, b) => {
      const order = { critical: 0, high: 1, normal: 2 };
      return (order[a.summaryImportance] || 2) - (order[b.summaryImportance] || 2);
    });
    if (orderedSummaries.length > 0) {
      messages.push({
        role: 'system',
        content: `[历史摘要]\n${orderedSummaries.map(s => s.modelOutput).join('\n')}`,
      });
    }

    // 4. 保护的历史轮次(硬门控) + 最近全量对话
    const history = [...decided.protectedTurns, ...decided.recentFull.slice(-20)];
    for (const turn of history) {
      if (turn.userInput) messages.push({ role: 'user', content: turn.userInput });
      if (turn.modelTurn?.message) messages.push({ role: 'assistant', content: turn.modelTurn.message });
    }

    // 5. askingField null 降级: 纯语义匹配(不报错不阻断)
    if (!currentAskField) {
      messages.push({ role: 'system', content: '[当前无追问字段,硬门控降级为纯语义匹配]' });
    }

    return messages;
  }
}
