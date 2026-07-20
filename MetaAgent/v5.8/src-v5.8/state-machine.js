// @MetaAgent v5.8 — state-machine.js
// 8 状态 + 17 IN_SESSION 子类型 + 状态转移规则

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATES = {
  IDLE:             'IDLE',
  LISTENING:        'LISTENING',
  ANALYZING:        'ANALYZING',
  IN_SESSION:       'IN_SESSION',
  CLARIFYING:       'CLARIFYING',
  WAITING_CONFIRM:  'WAITING_CONFIRM',
  EXECUTING:        'EXECUTING',
  CLOSING:          'CLOSING',
};

export const STATE_TYPE = {
  IDLE:             'steady',
  LISTENING:        'steady',
  ANALYZING:        'transient',
  IN_SESSION:       'steady_container',
  CLARIFYING:       'guardian',
  WAITING_CONFIRM:  'guardian',
  EXECUTING:        'transient',
  CLOSING:          'transient',
};

export const EXECUTOR = {
  IDLE:             'none',
  LISTENING:        'human',
  ANALYZING:        'llm_light',
  IN_SESSION:       'llm_instance',
  CLARIFYING:       'det',
  WAITING_CONFIRM:  'human',
  EXECUTING:        'det',
  CLOSING:          'det',
};

export class StateMachine {
  constructor(l3Path) {
    // 加载 L3 配置
    const statesRaw = readFileSync(join(l3Path, 'states.json'), 'utf-8');
    const transitionsRaw = readFileSync(join(l3Path, 'transitions.json'), 'utf-8');
    this._statesConfig = JSON.parse(statesRaw);
    this._transitions = JSON.parse(transitionsRaw);

    // 构建 intent 索引
    this._subtypes = new Map();
    for (const sub of this._statesConfig.inSessionSubtypes) {
      this._subtypes.set(sub.intent, sub);
    }

    this._state = STATES.IDLE;
    this._currentIntent = null;
    this._taskType = null;
  }

  get state() { return this._state; }
  get currentIntent() { return this._currentIntent; }
  get taskType() { return this._taskType; }

  /** 获取当前状态的完整 IN_SESSION 标识 */
  get fullState() {
    if (this._state === STATES.IN_SESSION && this._currentIntent) {
      return `IN_SESSION(${this._currentIntent})`;
    }
    return this._state;
  }

  /** 获取 intent 对应的子类型配置 */
  getSubtype(intent) {
    return this._subtypes.get(intent) || null;
  }

  /** 获取 intent 对应的 taskType */
  getTaskType(intent) {
    const sub = this._subtypes.get(intent);
    return sub ? sub.taskType : null;
  }

  /** 获取 intent 的 importance */
  getImportance(intent) {
    const sub = this._subtypes.get(intent);
    return sub?.importance || 'normal';
  }

  /** 是否启用 topicEvolution */
  isTopicEvolutionEnabled(intent) {
    const sub = this._subtypes.get(intent);
    return sub?.topicEvolutionEnabled === true;
  }

  /** 所有 intent 列表 */
  get intentList() {
    return [...this._subtypes.keys()];
  }

  /** 获取 intent 的特殊机制 */
  getSpecial(intent) {
    const sub = this._subtypes.get(intent);
    return sub?.special || null;
  }

  /** 获取 intent 关联的机制列表 */
  getMechanisms(intent) {
    const sub = this._subtypes.get(intent);
    return sub?.mechanisms || [];
  }

  /** 执行状态转移 */
  transition(targetState, intent = null, taskType = null) {
    const from = this.fullState;

    // dev-mode: 从 transient 直接跳 steady 可能丢失中间状态
    if (process.env.NODE_ENV !== 'production') {
      const fromType = STATE_TYPE[this._state] || 'unknown';
      const toType = STATE_TYPE[targetState] || 'unknown';
      if (fromType === 'transient' && toType === 'steady') {
        console.warn(`[state-machine] dev-warn: transient→steady 转移 ${from}→${targetState}(${intent}), 确认不是跳状态?`);
      }
    }

    this._state = targetState;
    this._currentIntent = intent;
    this._taskType = taskType;
    return { from, to: this.fullState };
  }

  /** 按 trigger 查找转移边 */
  findTransition(fromState, trigger) {
    for (const t of this._transitions) {
      if (this._matchFrom(fromState, t.from) && t.trigger.includes(trigger)) {
        return t;
      }
    }
    return null;
  }

  /** 获取从任意状态出发的转移（switch/cancel 等） */
  getGlobalTransitions(fromState, trigger) {
    return this._transitions.filter(t => t.from === '任意' && t.trigger.includes(trigger));
  }

  _matchFrom(actual, pattern) {
    if (actual === pattern) return true;
    if (pattern.startsWith('IN_SESSION(') && actual.startsWith('IN_SESSION(')) {
      const pType = pattern.match(/IN_SESSION\((\w+)/)?.[1];
      const aIntent = actual.match(/IN_SESSION\((\w+)/)?.[1];
      if (pType && aIntent) {
        const aTaskType = this.getTaskType(aIntent);
        if (pType === 'topic' && aTaskType === 'topic_based') return true;
        if (pType === 'field' && aTaskType === 'field_based') return true;
      }
    }
    if (pattern === 'IN_SESSION' && actual.startsWith('IN_SESSION(')) return true;
    return false;
  }

  /** 是否为 steady 状态（需要等待外部输入） */
  isSteady() {
    return [STATES.IDLE, STATES.LISTENING, STATES.WAITING_CONFIRM].includes(this._state);
  }

  /** 是否为稳态容器 */
  isSteadyContainer() {
    return this._state === STATES.IN_SESSION;
  }
}
