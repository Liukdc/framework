// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 调度器状态机 — 富贵小安 v4.0 核心
 *
 * 8 状态: IDLE → LISTENING → ANALYZING → IN_SESSION → CLARIFYING → WAITING_CONFIRM → EXECUTING → CLOSING
 *
 * 三层路由架构（L3 设计）：
 *   Layer 0: 口令层 EXACT_MATCH 硬匹配（0 LLM 调用）
 *   Layer 0.5: DET 关键词扫描辅助偏离检测
 *   Layer 1: 语义确认层（ANALYZING → 意图识别 → 置信度路由）
 *
 * 路由规则为确定性代码，不调 LLM。
 *
 * @module fugui-xiaoan/state-machine
 */

import {
  ARTICLE1_META_INSTRUCTION,
  ARTICLE4_DEGRADATION,
  ARTICLE6_TRANSITION_GUARD,
  ARTICLE7_AMBIGUOUS_GOAL,
} from './root-constitution.js';
import { TurnType, ChangeLevel, validateTurn } from './turnType.js';
import { getTunable, getTunableSnapshot } from './tunables.js';
import { detValidateRecord } from './constitution-record.js';
import { ContextManager } from './context-manager.js';

// ═══ 状态枚举（8 状态） ═══════════════
export const State = Object.freeze({
  IDLE:             'idle',
  LISTENING:        'listening',
  ANALYZING:        'analyzing',
  IN_SESSION:       'in_session',
  CLARIFYING:       'clarifying',
  WAITING_CONFIRM:  'waiting_confirm',
  EXECUTING:        'executing',
  CLOSING:          'closing',
});

// ═══ DET 值域约束 ═══════════════════════
const VALUE_CONSTRAINTS = Object.freeze({
  amount:   { min: 0, max: 999999, message: '金额似乎有问题，请重新输入。' },
  time:     { maxFuture: false, message: '时间不能在未来，请重新输入。' },
  quantity: { min: 0, max: 10000, message: '数量似乎有问题，请重新输入。' },
});

// ═══ DET 关键词扫描规则（L3 第0.5层） ═══
const OFF_TASK_KEYWORDS = Object.freeze({
  query:  ['查一下', '查询', '多少', '总共', '花了多少', '多少钱'],
  delete: ['删除', '删掉', '去掉'],
  exit:   ['拜拜', '退出', '好了'],
});

// ═══ 意图标签 ═══════════════════════════
const INTENT_LABELS = Object.freeze({
  record:  '记账',
  query:   '查询',
  delete:  '删除',
  compare: '比对',
  exit:    '退出',
  other:   '询问',
});

// ═══ Scheduler（调度器） ═══════════════════

export class Scheduler {
  /**
   * @param {object} opts
   * @param {string} [opts.mode='simple'] - 记账模式 simple|detailed
   * @param {string} [opts.apiKey] - LLM API Key
   * @param {Function} [opts.onOutput] - 输出回调 (text, type) => void
   * @param {Function} [opts.onStateChange] - 状态变更回调 (state) => void
   * @param {Function} [opts.identifyIntent] - 意图识别注入 (text, apiKey) => {intent, subType, confidence, extracted}
   * @param {Function} [opts.createSession] - 创建环节注入 (sessionParams) => turn
   * @param {Function} [opts.executeRecord] - 执行记账注入
   * @param {Function} [opts.executeQuery] - 执行查询注入
   * @param {Function} [opts.executeDelete] - 执行删除注入
   * @param {Function} [opts.executeCompare] - 执行比对注入
   */
  constructor(opts = {}) {
    // ── 核心状态 ──
    this._state = State.IDLE;
    this._mode = opts.mode || 'simple';
    this._apiKey = opts.apiKey || null;

    // ── 回调 ──
    this._onOutput = opts.onOutput || (() => {});
    this._onStateChange = opts.onStateChange || (() => {});

    // ── 环节数据 ──
    this._activeIntent = null;
    this._activeSubType = null;
    this._collectedFields = {};
    this._pendingOffTask = null;
    this._pendingConfirm = null;
    this._lastRecord = null;
    this._lastModelTurn = null;

    // ── 环节内轮次历史 ──
    this._turnHistory = [];
    this._sessionLLMCalls = 0;

    // ── 意图防抖 ──
    this._antiFlapHistory = [];
    this._antiFlapLocked = false;

    // ── 冷启动计数器 ──
    this._coldStartSessionCount = 0;

    // ── 上下文管理器 ──
    this._contextManager = new ContextManager({
      maxTurns: getTunable('turnHistory_limit'),
    });

    // ── 外部注入 ──
    this._identifyIntent = opts.identifyIntent || (async () => ({ intent: 'other', confidence: 0 }));
    this._createSession = opts.createSession || (async () => ({ turnType: 'complete', message: '' }));
    this._executeRecord = opts.executeRecord || (async () => {});
    this._executeQuery = opts.executeQuery || (async () => ({}));
    this._executeDelete = opts.executeDelete || (async () => {});
    this._executeCompare = opts.executeCompare || (async () => ({}));
  }

  // ── 公开属性 ──────────────────────
  get state()          { return this._state; }
  get activeIntent()   { return this._activeIntent; }
  get collectedFields(){ return { ...this._collectedFields }; }

  /**
   * 获取调度器完整状态快照（对齐 L3 schedulerState 结构）。
   * @returns {object}
   */
  getSchedulerState() {
    return {
      state: this._state,
      mode: this._mode,
      activeIntent: this._activeIntent,
      activeSubType: this._activeSubType,
      collectedFields: { ...this._collectedFields },
      turnHistoryLength: this._turnHistory.length,
      sessionLLMCalls: this._sessionLLMCalls,
      coldStartSessionCount: this._coldStartSessionCount,
      antiFlapLocked: this._antiFlapLocked,
      context: this._contextManager.getSnapshot(),
      tunables: getTunableSnapshot(),
    };
  }

  // ── 状态管理 ──────────────────────
  _setState(s) {
    this._state = s;
    this._onStateChange(s);
  }

  _output(text, type = 'system') {
    if (text) this._onOutput(text, type);
  }

  // ═══ 入口 ═══════════════════════════

  /**
   * 接收用户输入，执行路由分发。
   *
   * @param {string} text - 用户输入
   * @returns {Promise<{reply: string, state: string}>}
   */
  async handleInput(text) {
    const t = (text || '').trim();
    if (!t) return { reply: '', state: this._state };

    // ── 第 0 层：口令层 EXACT_MATCH ──
    const metaRoute = this._checkPassphraseLayer(t);
    if (metaRoute) return metaRoute;

    // ── 第 0.5 层：DET 关键词扫描 ──
    if (this._state === State.IN_SESSION) {
      const suspicion = this._detKeywordScan(t);
      if (suspicion) {
        this._contextManager.injectOffTaskSuspicion({
          userInput: t,
          offTaskSuspicion: suspicion,
          time: Date.now(),
        });
        this._turnHistory.push({
          userInput: t,
          offTaskSuspicion: suspicion,
          time: Date.now(),
        });
      }
    }

    // ── 状态分发 ──
    switch (this._state) {
      case State.IDLE:            return this._handleIdle(t);
      case State.LISTENING:       return this._handleListening(t);
      case State.IN_SESSION:      return this._handleInSession(t);
      case State.CLARIFYING:      return this._handleClarifying(t);
      case State.WAITING_CONFIRM: return this._handleWaitingConfirm(t);
      default:                    return { reply: '', state: this._state };
    }
  }

  // ═══ 第 0 层：口令层 EXACT_MATCH（0 LLM） ═══

  /**
   * 口令层硬匹配。
   * 只接受精确字符串匹配，不使用正则/模糊匹配。
   * 设计目标：0 次 LLM 调用完成口令识别。
   */
  _checkPassphraseLayer(text) {
    const pp = ARTICLE1_META_INSTRUCTION.passphrases;
    const exact = text.trim();

    // 退出词（任意态）→ CLOSING → IDLE
    if (exact === pp.exit) {
      this._handleClosing();
      return { reply: '', state: this._state };
    }

    // 唤醒词（仅 IDLE 态）
    if (this._state === State.IDLE && exact === pp.wake) {
      this._setState(State.LISTENING);
      const modeLabel = this._mode === 'simple' ? '简单' : '细致';
      this._output(`小安在呢。（${modeLabel}模式）想记什么？`, 'system');
      return { reply: '', state: this._state };
    }

    // 取消词（IN_SESSION / CLARIFYING / WAITING_CONFIRM 态）
    if (
      [State.IN_SESSION, State.CLARIFYING, State.WAITING_CONFIRM].includes(this._state) &&
      exact === pp.cancel
    ) {
      this._collectedFields = {};
      this._pendingOffTask = null;
      this._pendingConfirm = null;
      this._lastModelTurn = null;
      this._contextManager.reset();
      this._output('好的，不记了。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    return null; // 非口令，放行到语义确认层
  }

  // ═══ CLOSING 态 ═══════════════════════

  _handleClosing() {
    this._setState(State.CLOSING);
    this._output('都记好啦，拜拜。', 'system');
    this._collectedFields = {};
    this._activeIntent = null;
    this._activeSubType = null;
    this._turnHistory = [];
    this._lastModelTurn = null;
    this._contextManager.reset();
    this._setState(State.IDLE);
  }

  // ═══ 第 0.5 层：DET 关键词扫描 ═══════

  /**
   * 对用户输入做关键词扫描，检测跨意图词汇。
   * @param {string} text
   * @returns {string|null} offTaskSuspicion 标记或 null
   */
  _detKeywordScan(text) {
    if (this._activeIntent === 'record') {
      if (OFF_TASK_KEYWORDS.query.some(kw => text.includes(kw))) return 'query';
      if (OFF_TASK_KEYWORDS.delete.some(kw => text.includes(kw))) return 'delete';
    }
    if (![State.IDLE, State.LISTENING].includes(this._state)) {
      if (OFF_TASK_KEYWORDS.exit.some(kw => text.includes(kw))) return 'exit';
    }
    return null;
  }

  // ═══ IDLE ════════════════════════════

  async _handleIdle(text) {
    this._output('说"小安开账"叫醒我。', 'system');
    return { reply: '', state: this._state };
  }

  // ═══ LISTENING → ANALYZING：意图识别 ═══

  async _handleListening(text) {
    this._setState(State.ANALYZING);
    this._output('…', 'thinking');

    // ── 冷启动窗口软拦截 ──
    this._coldStartSessionCount++;
    const coldWindow = getTunable('cold_start_observation_window');
    if (this._coldStartSessionCount <= coldWindow) {
      // 冷启动期内：记录但不阻断，降低阈值要求
    }

    let result;
    try {
      result = await this._identifyIntent(text, this._apiKey);
    } catch (e) {
      this._output('脑子有点晕，再说一次？', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    const { intent, subType, confidence, extracted } = result;

    // ── 意图防抖 ──
    if (this._checkAntiFlap(intent)) {
      this._output(`确定是要${INTENT_LABELS[intent] || intent}对吗？`, 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    // ── 置信度路由 ──
    if (confidence >= 80) {
      // 高置信度 → 直接分发
    } else if (confidence >= 60) {
      // 中置信度 → 确认
      const guide = `您是想要${INTENT_LABELS[intent] || intent}吗？`;
      this._output(guide, 'system');
      this._setState(State.LISTENING);
      return { reply: guide, state: this._state };
    } else {
      // 低置信度 → 引导
      const guide = '没听明白。小安只会记账。';
      this._output(guide, 'system');
      this._setState(State.LISTENING);
      return { reply: guide, state: this._state };
    }

    // ── intent=exit → 直接退出 ──
    if (intent === 'exit') {
      this._handleClosing();
      return { reply: '', state: this._state };
    }

    // ── intent=other → 直接回复后回 LISTENING ──
    if (intent === 'other') {
      this._output('小安只会记账哦。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    // ── 进入环节 ──
    this._activeIntent = intent;
    this._activeSubType = subType || null;
    this._collectedFields = extracted || {};
    this._turnHistory = [];
    this._sessionLLMCalls = 0;
    this._contextManager.reset();
    this._contextManager.setCurrentRoom(`${intent}_${Date.now()}`);

    return this._startSession(text, extracted || {});
  }

  // ═══ IN_SESSION：环节内监督循环 ═══

  async _startSession(text, extracted) {
    this._setState(State.IN_SESSION);

    if (!this._createSession) {
      this._output('环节引擎未初始化。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    try {
      const turn = await this._createSession({
        intent: this._activeIntent,
        subType: this._activeSubType,
        userInput: text,
        collectedFields: extracted,
        turnHistory: this._turnHistory,
        apiKey: this._apiKey,
        mode: this._mode,
      });

      this._sessionLLMCalls++;
      this._lastModelTurn = turn;

      return this._dispatchTurn(turn, text);
    } catch (e) {
      this._output('脑子有点晕，再说一次？', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
  }

  async _handleInSession(text) {
    try {
      // 上下文注入：buildPromptContext
      const ctx = this._contextManager.buildPromptContext(text, this._collectedFields);

      const turn = await this._createSession({
        intent: this._activeIntent,
        subType: this._activeSubType,
        userInput: text,
        collectedFields: this._collectedFields,
        turnHistory: this._turnHistory.slice(-getTunable('turnHistory_limit')),
        promptContext: ctx.context,
        apiKey: this._apiKey,
        mode: this._mode,
      });

      this._sessionLLMCalls++;
      this._lastModelTurn = turn;

      return this._dispatchTurn(turn, text);
    } catch (e) {
      // L1 降级：重试 1 次
      try {
        const turn = await this._createSession({
          intent: this._activeIntent,
          subType: this._activeSubType,
          userInput: text,
          collectedFields: this._collectedFields,
          apiKey: this._apiKey,
          mode: this._mode,
        });
        this._sessionLLMCalls++;
        this._lastModelTurn = turn;
        return this._dispatchTurn(turn, text);
      } catch (e2) {
        // L1 重试耗尽 → 硬编码兜底
        this._output(ARTICLE4_DEGRADATION.hardcodedFallback, 'system');
        this._setState(State.LISTENING);
        return { reply: ARTICLE4_DEGRADATION.hardcodedFallback, state: this._state };
      }
    }
  }

  /**
   * 根据 turnType 分发环节结果（L3 6 种 turnType）。
   * 包含 changeLevel 处理。
   */
  async _dispatchTurn(turn, userText) {
    const { turnType, message, askingField, changeLevel, changeLevelReason,
            validationResult, offTaskInput, collectedFields, result } = turn;
    this._lastModelTurn = turn;

    // ── L1 结构检查：验证 turn 格式 ──
    const validation = validateTurn(turn);
    if (!validation.valid) {
      this._output(ARTICLE4_DEGRADATION.hardcodedFallback, 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    // ── changeLevel 处理 ──
    if (changeLevel && changeLevel !== ChangeLevel.INVALID) {
      // 记录 changeLevel 用于审计
      this._turnHistory.push({
        userInput: userText,
        modelTurn: { turnType, changeLevel, changeLevelReason },
        time: Date.now(),
        changeLevelAudit: true,
      });
    }

    // ── 更新 collectedFields ──
    if (collectedFields) {
      this._collectedFields = { ...this._collectedFields, ...collectedFields };
    }

    // ── 记录本轮（非 changeLevel 审计记录） ──
    if (!changeLevel || changeLevel === ChangeLevel.INVALID) {
      this._turnHistory.push({
        userInput: userText,
        modelTurn: turn,
        time: Date.now(),
      });
    }
    if (this._turnHistory.length > getTunable('turnHistory_limit')) {
      this._turnHistory = this._turnHistory.slice(-getTunable('turnHistory_limit'));
    }

    // ── 上下文管理器记录 ──
    this._contextManager.addTurn('user', userText, this._collectedFields, null, {
      importance: this._activeIntent === 'record' ? 'critical' : 'normal',
    });
    if (message) {
      this._contextManager.addTurn('assistant', message, this._collectedFields, turnType, {
        importance: turnType === TurnType.ASK || turnType === TurnType.VALIDATION_FAILED
          ? 'critical' : 'normal',
      });

      // 硬门控：ask / validation_failed → 保护其依赖轮次
      if (turnType === TurnType.ASK || turnType === TurnType.VALIDATION_FAILED) {
        const lastIdx = this._contextManager.turns.length - 1;
        this._contextManager.fieldLevelHardGate(lastIdx);
      }
    }

    // ── 按 turnType 分发 ──
    switch (turnType) {
      case TurnType.ASK:
      case TurnType.REPLY:
        if (message) this._output(message, turnType === TurnType.ASK ? 'system' : 'done');
        return { reply: message || '', state: this._state };

      case TurnType.VALIDATION_FAILED:
        this._setState(State.CLARIFYING);
        if (message) this._output(message, 'system');
        return { reply: message || '', state: this._state };

      case TurnType.OFF_TASK:
        this._setState(State.ANALYZING);
        this._pendingOffTask = { collectedFields: this._collectedFields, offTaskInput };
        this._contextManager.archiveContext();
        this._activeIntent = null;
        return this._handleListening(offTaskInput || userText);

      case TurnType.GIVEUP:
        this._setState(State.LISTENING);
        this._output('好的。', 'system');
        this._contextManager.archiveContext();
        this._activeIntent = null;
        return { reply: '', state: this._state };

      case TurnType.COMPLETE: {
        // ── DET 值域复验（record 环节） ──
        if (this._activeIntent === 'record') {
          const detResult = detValidateRecord(result || this._collectedFields);
          if (!detResult.valid) {
            this._setState(State.CLARIFYING);
            this._output(detResult.message, 'system');
            return { reply: detResult.message, state: this._state };
          }
        }

        // ── L2 禁用语扫描 ──
        if (message) {
          const l2Result = this._l2Scan(message);
          if (l2Result !== message) {
            this._output(l2Result, 'system');
            return { reply: l2Result, state: this._state };
          }
        }

        // ── 执行 ──
        return this._execute();
      }

      default:
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
    }
  }

  // ═══ CLARIFYING：校验失败追问转发 ═══

  async _handleClarifying(text) {
    this._setState(State.IN_SESSION);
    this._turnHistory.push({
      userInput: text,
      note: 'clarifying_retry',
      previousValidation: this._lastModelTurn?.validationResult,
      time: Date.now(),
    });

    // 硬门控：保护上次校验失败的轮次
    const lastIdx = this._contextManager.turns.length - 1;
    this._contextManager.fieldLevelHardGate(lastIdx);

    return this._handleInSession(text);
  }

  // ═══ WAITING_CONFIRM ═══════════════════

  _handleWaitingConfirm(text) {
    const t = text.trim();
    if (/^是$|^确认$|^删掉$|^好$|^yes$/i.test(t)) {
      this._setState(State.EXECUTING);
      if (this._pendingConfirm) this._pendingConfirm();
      this._output('已删除。', 'done');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
    if (/^不是$|^算了$|^取消$|^no$/i.test(t)) {
      this._output('好的，不删了。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
    this._output('确认要删除吗？（是/不是）', 'system');
    return { reply: '', state: this._state };
  }

  // ═══ 执行 ════════════════════════════

  async _execute() {
    this._setState(State.EXECUTING);

    try {
      switch (this._activeIntent) {
        case 'record': {
          const r = this._lastModelTurn?.result || this._collectedFields;
          await this._executeRecord(r);
          this._lastRecord = r;
          if (this._lastModelTurn?.message) {
            this._output(this._lastModelTurn.message, 'done');
          }
          break;
        }
        case 'query': {
          const qr = await this._executeQuery(this._lastModelTurn?.result || {});
          if (qr?.reply) this._output(qr.reply, 'done');
          break;
        }
        case 'delete': {
          this._setState(State.WAITING_CONFIRM);
          this._pendingConfirm = async () => {
            await this._executeDelete(this._lastModelTurn?.result || {});
          };
          this._output('确认要删除吗？', 'system');
          return { reply: '', state: this._state };
        }
        case 'compare': {
          const cr = await this._executeCompare(this._lastModelTurn?.result || {});
          if (cr?.reply) this._output(cr.reply, 'done');
          break;
        }
        default:
          break;
      }
    } catch (e) {
      this._output('执行出错了，请重试。', 'system');
    }

    // ── 归档上下文 ──
    this._contextManager.archiveContext();

    this._activeIntent = null;
    this._activeSubType = null;
    this._collectedFields = {};
    this._turnHistory = [];
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  // ═══ DET 值域复验 ═══════════════════════

  /**
   * 对 complete 结果做确定性值域校验（record 环节）。
   * @param {object} result
   * @returns {{ valid: boolean, message?: string }}
   */
  _detValidateResult(result) {
    // 委托给 constitution-record 的 DET 校验
    return detValidateRecord(result);
  }

  _parseTimeForValidation(t) {
    const now = new Date();
    const text = t.trim();
    if (text === '今天')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    if (text === '昨天')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    if (text === '明天')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    if (text === '后天')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  // ═══ L2 禁用语扫描 ═══════════════════

  /**
   * 扫描模型输出中的禁用语。
   * 命中 → 替换为硬编码兜底文本。
   */
  _l2Scan(reply) {
    if (!reply || typeof reply !== 'string') return reply;
    const terms = ARTICLE4_DEGRADATION.l2ForbiddenTerms;
    const hit = terms.find((t) => reply.includes(t));
    return hit ? ARTICLE4_DEGRADATION.hardcodedFallback : reply;
  }

  // ═══ 意图防抖 ═══════════════════════

  /**
   * 60s 内 ≥2 个不同意图且 ≥3 次切换 → 锁定第一个意图。
   */
  _checkAntiFlap(intent) {
    const now = Date.now();
    const windowMs = 60000;

    this._antiFlapHistory = this._antiFlapHistory.filter(
      (h) => now - h.time < windowMs
    );
    this._antiFlapHistory.push({ intent, time: now });

    const uniqueIntents = new Set(this._antiFlapHistory.map((h) => h.intent));

    if (uniqueIntents.size >= 2 && this._antiFlapHistory.length >= 3) {
      this._antiFlapLocked = true;
      return true;
    }

    if (uniqueIntents.size > 2) {
      this._antiFlapLocked = false;
    }

    return false;
  }

  // ═══ 工具 ═══════════════════════════

  _intentLabel(intent) {
    return INTENT_LABELS[intent] || intent;
  }

  // ═══ 重置 ═══════════════════════════

  reset() {
    this._state = State.IDLE;
    this._activeIntent = null;
    this._activeSubType = null;
    this._collectedFields = {};
    this._pendingOffTask = null;
    this._pendingConfirm = null;
    this._lastRecord = null;
    this._lastModelTurn = null;
    this._turnHistory = [];
    this._sessionLLMCalls = 0;
    this._antiFlapHistory = [];
    this._antiFlapLocked = false;
    this._coldStartSessionCount = 0;
    this._contextManager.reset();
  }
}

export default Scheduler;
