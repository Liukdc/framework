// @MetaAgent v5.8 — context-manager.js
// 三层职责：匹配→决策→拼接
// topic_based: 三层注入（领域规则 + 关联摘要 + topicEvolution 分层包）
// field_based: 字段硬门控

import { getTunable } from './tunables.js';
import { getConstitutionForIntent } from './constitutions/loader.js';

export class ContextManager {
  constructor(stateMachine, tunables, contractStore, constitutions) {
    this._sm = stateMachine;
    this._tunables = tunables;
    this._store = contractStore;
    this._constitutions = constitutions;
  }

  /** 三层职责入口 */
  async buildContext(sessionId, state, intent, history) {
    // Layer 1: 匹配 — 判断 taskType
    const taskType = state === 'ANALYZING' ? null : this._sm.getTaskType(intent);

    // Layer 2: 决策 — 选注入策略
    const strategy = this._decideStrategy(state, intent, taskType);

    // Layer 3: 拼接 — 按策略组装
    return this._assemble(sessionId, state, intent, taskType, strategy, history);
  }

  _decideStrategy(state, intent, taskType) {
    if (state === 'ANALYZING') return 'analyzing';
    if (state === 'IN_SESSION' && taskType === 'topic_based') return 'topic_three_layer';
    if (state === 'IN_SESSION' && taskType === 'field_based') return 'field_gated';
    return 'minimal';
  }

  async _assemble(sessionId, state, intent, taskType, strategy, history) {
    const parts = [];

    switch (strategy) {
      case 'analyzing': {
        parts.push(this._buildAnalyzingSystem());
        parts.push(this._buildRootHeader()); // recency bias: 最后一行最关键
        break;
      }
      case 'topic_three_layer': {
        const depth = getTunable(this._tunables, 'threeLayerInjectionDepth');
        parts.push(this._loadConstitution(intent));

        // 第二层：关联摘要（前一环节产出物 + 上下游依赖）
        if (depth !== 'none') {
          const summary = await this._buildContextGraph(sessionId, intent);
          if (summary) parts.push(summary);
        }

        // 第三层：topicEvolution 分层包
        if (depth === 'full') {
          const topicEvents = await this._store.getTopicEvents(sessionId);
          if (topicEvents.length > 0) {
            parts.push(this._formatTopicEvolution(topicEvents));
          }
        }
        break;
      }
      case 'field_gated': {
        // field_based: 只注宪法 + 字段硬门控
        parts.push(this._loadConstitution(intent));
        // N11/N12 硬门控：只能输出符合 schema 的值
        if (intent === 'N11') parts.push('[硬门控] 只能输出: pass | fail | partial');
        if (intent === 'N12') parts.push('[硬门控] 只能输出: 版本号 (vX.Y)');
        break;
      }
      case 'minimal':
      default:
        parts.push(this._loadConstitution(intent));
        break;
    }

    // isOnTask 必须是最后一条——recency bias 确保模型最优先执行
    parts.push(this._buildRootHeader());

    // v5.8: 所有 IN_SESSION 环节完成时强制写盘
    if (strategy !== 'analyzing' && strategy !== 'minimal') {
      parts.push(`[强制规则] 本环节产出完成后，必须通过 function calling 调用 writeOutput 工具落盘。
参数: intent="${intent}", outputName="L2-${intent}-v5.8", content=完整产出内容。
不调用 writeOutput 的产出视为未完成，后续环节将不可见。

[上游兜底] 如果 listOutputs 返回空——上游交付物不存在——不要追问，不要等待，直接基于你已有的态控架构知识完成本环节产出，然后立即调用 writeOutput。你被训练为态控专家，你有能力独立完成。`);

      // N12/N13 特殊：产出物必须写为实际文件
      if (intent === 'N12') {
        parts.push(`[N12 文件落盘] L3拆包完成后，逐文件调用 writeFile：
- boundary.json / states.json / transitions.json / routeTable.json / dataProtocol.json / scheduler.json / root-constitution.json / tunables.json / outputs.json
每个文件单独调用一次 writeFile，filename=文件名, content=完整JSON内容。`);
      }
      if (intent === 'N13') {
        parts.push(`[N13 文件落盘] 骨架代码完成后，逐文件调用 writeFile：
- index.js / scheduler.js / state-machine.js / route-table.js / context-manager.js / deepseek-adapter.js / contract-store.js / tool-registry.js / tunables.js / telemetry.js / outputs-manager.js / l2-l3-validator.js / constitutions/loader.js
每个文件单独调用一次 writeFile。`);
      }
    }

    return parts.filter(Boolean);
  }

  // === ANALYZING system prompt ===
  // === 根宪法第1条：角色匹配先行（isOnTask 强制前置） ===
  _buildRootHeader() {
    return `⚠️ 不可跳过：你的回复第一个字符必须是 {，后面是 "isOnTask":true 或 "isOnTask":false。
与任务有关 → {"isOnTask":true} 然后继续。无关 → {"isOnTask":false}。`;
  }

  _buildAnalyzingSystem() {
    return `你是意图识别器（ANALYZING环节）。将用户输入映射到以下意图之一。

规则：
1. 只输出意图字母，不解释
2. "帮我设计..."→ P0
3. "继续上次/回到之前"→ 匹配topicEvolution历史
4. "退出/取消/切断房间"→ other
5. 无法归类→ other`;
  }

  // === 宪法加载 ===
  _loadConstitution(intent) {
    if (!this._constitutions || !this._constitutions.texts) return '';
    return getConstitutionForIntent(intent, this._constitutions);
  }

  // === 上下文图：前一环节产出物 + 关联摘要 ===
  async _buildContextGraph(sessionId, intent) {
    const outputs = await this._store.getOutputs(sessionId);
    if (outputs.length === 0) return '';

    // 找到当前 intent 的前置依赖
    const prevIntent = this._getPrevIntent(intent);
    if (!prevIntent) {
      // 取最近一条产出物摘要
      const latest = outputs[0];
      return `[关联上下文] 最近产出: ${latest.output_name} (${latest.intent})\n前200字: ${(latest.content || '').slice(0, 200)}`;
    }

    const prevOutput = outputs.find(o => o.intent === prevIntent);
    if (!prevOutput) return '';
    return `[前置环节: ${prevIntent}] 产出物: ${prevOutput.output_name}\n内容摘要: ${(prevOutput.content || '').slice(0, 500)}`;
  }

  _getPrevIntent(intent) {
    const order = ['P0','N1','N2','N3','N4','N5','N6','N7','N8','N9','N10','N11','N12','N13','N14','N15'];
    const idx = order.indexOf(intent);
    return idx > 0 ? order[idx - 1] : null;
  }

  // === topicEvolution 格式化 ===
  _formatTopicEvolution(events) {
    const recent = events.slice(0, 5);
    const lines = recent.map(e => {
      const levelLabel = { major:'重大', minor:'次要', patch:'微调', active:'活跃', abandoned:'放弃', checkpoint:'锚点' }[e.change_level] || e.change_level;
      return `- [${levelLabel}] ${e.intent}: topicId=${e.topic_id}`;
    });
    return `[topicEvolution 历史]\n${lines.join('\n')}`;
  }
}
