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
        break;
      }
      case 'topic_three_layer': {
        const depth = getTunable(this._tunables, 'threeLayerInjectionDepth');

        // 第一层：领域规则（环节宪法）
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

    return parts.filter(Boolean);
  }

  // === ANALYZING system prompt ===
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
