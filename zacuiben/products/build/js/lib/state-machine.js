// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 状态机 — 杂碎本 v3.0
 *
 * 基于 L3 设计：11 状态 + 口令层 EXACT_MATCH + 意图防抖 +
 * DET 值域复验 + 附件校验 + 整理流转（skipCount 自动废弃）+ 冷启动窗口。
 *
 * @module zacuiben/state-machine
 */

// ═══════════════════════════════════════════════════════════
// 11 状态定义
// ═══════════════════════════════════════════════════════════

export const State = Object.freeze({
  IDLE:        'idle',
  LISTENING:   'listening',
  ANALYZING:   'analyzing',
  RECORDING:   'recording',
  SEARCHING:   'searching',
  ORGANIZING:  'organizing',
  SETTING:     'setting',
  CONFIRMING:  'confirming',
  VALIDATING:  'validating',
  EXECUTING:   'executing',
  CLOSING:     'closing',
});

// ═══════════════════════════════════════════════════════════
// 口令层 — EXACT_MATCH
// ═══════════════════════════════════════════════════════════

const WAKE_PATTERN = /^杂碎本[，,]\s*记\s*一\s*下[。！!]?/;
const EXIT_WORDS = new Set(['拜拜', '退出', '再见', '关闭']);
const CANCEL_WORDS = new Set(['算了', '不记了', '不要了', '取消']);

/**
 * 口令精确匹配检查（不含包容匹配）
 * @param {string} text
 * @returns {{ wake: boolean, exit: boolean, cancel: boolean }}
 */
export function matchPassword(text) {
  const t = (text || '').trim();
  // 只有以"杂碎本，记一下"开头才算唤醒
  const wake = WAKE_PATTERN.test(t);
  // 退出词：严格相等
  const exit = EXIT_WORDS.has(t);
  // 取消词
  const cancel = CANCEL_WORDS.has(t);

  return { wake, exit, cancel };
}

/**
 * 从唤醒文本中提取后续内容
 * @param {string} text
 * @returns {string} 去除口令后的纯内容
 */
export function extractAfterWake(text) {
  const t = (text || '').trim();
  return t.replace(WAKE_PATTERN, '').trim();
}

// ═══════════════════════════════════════════════════════════
// 意图防抖器
// ═══════════════════════════════════════════════════════════

export class AntiFlapGuard {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.windowSize=3] - 滑动窗口大小
   * @param {number} [opts.flapThreshold=2] - 变化次数阈值（≥此值触发锁定）
   */
  constructor(opts = {}) {
    this._windowSize = opts.windowSize || 3;
    this._flapThreshold = opts.flapThreshold || 2;
    /** @type {string[]} */
    this._history = [];
  }

  /**
   * 记录一次意图识别结果，返回防抖判定
   *
   * @param {string} intent - 本次识别的意图
   * @returns {{ locked: boolean, anchorIntent: string|null, changeCount: number }}
   */
  record(intent) {
    this._history.push(intent);
    if (this._history.length > this._windowSize) {
      this._history = this._history.slice(-this._windowSize);
    }

    // 窗口不满 → 不锁
    if (this._history.length < this._windowSize) {
      return { locked: false, anchorIntent: null, changeCount: 0 };
    }

    // 统计窗口内意图变化次数
    let changeCount = 0;
    for (let i = 1; i < this._history.length; i++) {
      if (this._history[i] !== this._history[i - 1]) {
        changeCount++;
      }
    }

    // 变化次数 ≥ 阈值 → 锁定到最早意图
    const locked = changeCount >= this._flapThreshold;
    const anchorIntent = locked ? this._history[0] : null;

    return { locked, anchorIntent, changeCount };
  }

  /** 重置防抖器 */
  reset() {
    this._history = [];
  }
}

// ═══════════════════════════════════════════════════════════
// DET 值域复验
// ═══════════════════════════════════════════════════════════

/**
 * DET（确定性执行测试）值域复验器
 * 在 LLM 返回结果后，用纯规则再次校验关键字段。
 */
export const DET = {
  /**
   * 内容长度校验
   * @param {string} content
   * @param {number} [maxLen=5000]
   * @returns {{ valid: boolean, error?: string }}
   */
  checkContentLength(content, maxLen = 5000) {
    if (!content) return { valid: true };
    if (content.length > maxLen) {
      return { valid: false, error: `内容太长了，请精简到 ${maxLen} 字以内` };
    }
    return { valid: true };
  },

  /**
   * 附件数量校验
   * @param {Array} attachments
   * @param {number} [maxCount=5]
   * @returns {{ valid: boolean, error?: string }}
   */
  checkAttachmentCount(attachments, maxCount = 5) {
    if (!attachments || !Array.isArray(attachments)) return { valid: true };
    if (attachments.length > maxCount) {
      return { valid: false, error: `附件数量已达上限（${maxCount}个）` };
    }
    return { valid: true };
  },

  /**
   * 附件大小校验
   * @param {Object} attachment - { type, size }
   * @param {Object} [limits] - { image: number, video: number, audio: number, default: number } 单位 MB
   * @returns {{ valid: boolean, error?: string }}
   */
  checkAttachmentSize(attachment, limits = {}) {
    if (!attachment) return { valid: true };

    const lim = {
      image: limits.image || 10,
      video: limits.video || 100,
      audio: limits.audio || 50,
      default: limits.default || 50,
    };

    let category = 'default';
    const t = (attachment.type || '').toLowerCase();
    if (t.startsWith('image/')) category = 'image';
    else if (t.startsWith('video/')) category = 'video';
    else if (t.startsWith('audio/')) category = 'audio';

    const maxBytes = lim[category] * 1024 * 1024;
    if (attachment.size > maxBytes) {
      return { valid: false, error: `附件过大：${category} 类文件上限 ${lim[category]}MB` };
    }
    return { valid: true };
  },

  /**
   * Key 名词校验
   *
   * 规则：中文字符长度≥2 && 不是纯数字 && 不是纯标点
   * @param {string} key
   * @returns {{ valid: boolean, error?: string }}
   */
  checkKeyHasNoun(key) {
    if (!key || !key.trim()) {
      return { valid: false, error: 'key_invalid' };
    }
    const t = key.trim();

    // 中文字符计数（CJK 统一表意文字 + 扩展 A）
    const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
    const cjkCount = (t.match(cjkPattern) || []).length;

    // 纯数字
    const isPureNumbers = /^\d+$/.test(t);

    // 纯标点/符号/空白（Unicode P + S 类别）
    const isPurePunct = /^[\p{P}\p{S}\s]+$/u.test(t);

    if (cjkCount >= 2 && !isPureNumbers && !isPurePunct) {
      return { valid: true };
    }

    return { valid: false, error: 'key_invalid' };
  },

  /**
   * 整理时间校验
   * @param {string} timeStr - 时间表达式
   * @param {number} [defaultDays=7]
   * @returns {{ valid: boolean, parsed: string|null, error?: string }}
   */
  checkOrganizeTime(timeStr, defaultDays = 7) {
    if (!timeStr || !timeStr.trim()) {
      return { valid: true, parsed: null };
    }

    const t = timeStr.trim();

    // "永不" / "never"
    if (t === '永不' || t === '永久' || t.toLowerCase() === 'never') {
      return { valid: true, parsed: 'never' };
    }

    // "默认" / "随便" / "default" → 使用默认天数
    if (t === '默认' || t === '随便' || t.toLowerCase() === 'default') {
      const d = new Date();
      d.setDate(d.getDate() + defaultDays);
      return { valid: true, parsed: d.toISOString() };
    }

    // "N天" / "N天后"
    const daysMatch = t.match(/^(\d+)\s*天[后後]?$/);
    if (daysMatch) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(daysMatch[1], 10));
      return { valid: true, parsed: d.toISOString() };
    }

    // "明天"
    if (t === '明天' || t === '明日') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return { valid: true, parsed: d.toISOString() };
    }

    // "后天"
    if (t === '后天' || t === '後天') {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      return { valid: true, parsed: d.toISOString() };
    }

    // 无法解析 → 返回默认
    const d = new Date();
    d.setDate(d.getDate() + defaultDays);
    return { valid: true, parsed: d.toISOString() };
  },
};

// ═══════════════════════════════════════════════════════════
// 附件校验器
// ═══════════════════════════════════════════════════════════

/**
 * 附件批量校验
 *
 * @param {Array<Object>} attachments - 附件列表
 * @param {Object} [limits] - 限制配置
 * @param {number} [limits.maxCount=5]
 * @param {number} [limits.imageMaxMb=10]
 * @param {number} [limits.videoMaxMb=100]
 * @param {number} [limits.audioMaxMb=50]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAttachments(attachments, limits = {}) {
  const errors = [];
  const maxCount = limits.maxCount || 5;
  const imageMaxMb = limits.imageMaxMb || 10;
  const videoMaxMb = limits.videoMaxMb || 100;
  const audioMaxMb = limits.audioMaxMb || 50;

  if (!attachments || !Array.isArray(attachments)) {
    return { valid: true, errors: [] };
  }

  if (attachments.length > maxCount) {
    errors.push(`附件数量超限（最多${maxCount}个，当前${attachments.length}个）`);
  }

  // 检查可执行文件
  const exeExts = new Set(['.exe', '.bat', '.cmd', '.sh', '.msi', '.app', '.dmg']);
  for (const att of attachments) {
    if (!att || !att.type) continue;

    // 可执行文件拦截
    const fileName = (att.path || att.name || '').toLowerCase();
    for (const ext of exeExts) {
      if (fileName.endsWith(ext)) {
        errors.push(`不支持可执行文件: ${att.path || att.name}`);
        break;
      }
    }

    // 大小检查
    const type = (att.type || '').toLowerCase();
    let maxBytes;
    if (type.startsWith('image/')) maxBytes = imageMaxMb * 1024 * 1024;
    else if (type.startsWith('video/')) maxBytes = videoMaxMb * 1024 * 1024;
    else if (type.startsWith('audio/')) maxBytes = audioMaxMb * 1024 * 1024;
    else maxBytes = 50 * 1024 * 1024; // 默认 50MB

    if (att.size && att.size > maxBytes) {
      const cat = type.startsWith('image/') ? '图片' : type.startsWith('video/') ? '视频' : type.startsWith('audio/') ? '音频' : '文件';
      const maxDisplay = type.startsWith('image/') ? imageMaxMb : type.startsWith('video/') ? videoMaxMb : type.startsWith('audio/') ? audioMaxMb : 50;
      errors.push(`${cat}附件过大（上限${maxDisplay}MB）: ${att.path || att.name}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════
// 状态机核心
// ═══════════════════════════════════════════════════════════

/**
 * 杂碎本 v3.0 状态机
 *
 * 11 状态流转表：
 *
 *   IDLE ──(醒词)──→ LISTENING ──(意图直发)──→ RECORDING/SEARCHING/ORGANIZING/SETTING
 *                     │                        │
 *                     └──(置信不足)──→ CONFIRMING ──→ RECORDING/... 或 LISTENING
 *
 *   RECORDING ──(完成)──→ VALIDATING ──(通过)──→ EXECUTING ──→ IDLE
 *   SEARCHING ──(完成)──→ EXECUTING ──→ IDLE
 *   ORGANIZING ──(队列空)──→ EXECUTING ──→ IDLE
 *   SETTING ──→ EXECUTING ──→ IDLE
 *
 *   任意非IDLE态 ──(退出词)──→ CLOSING ──(2s)──→ IDLE
 *   任意子进程态 ──(取消词)──→ IDLE
 */
export class StateMachine {
  /**
   * @param {Object} [opts]
   * @param {Function} [opts.onStateChange] - 状态变更回调 (newState, oldState) => void
   * @param {Object} [opts.tunables] - 可调参数快照
   * @param {number} [opts.coldStartWindow=300000] - 冷启动窗口（ms，默认5分钟）
   */
  constructor(opts = {}) {
    /** @type {string} */
    this._state = State.IDLE;
    /** @type {string|null} */
    this._prevState = null;
    /** @type {Object} */
    this._fields = {};
    /** @type {Object} */
    this._tunables = opts.tunables || {};
    /** @type {Function} */
    this._onStateChange = opts.onStateChange || (() => {});

    // 意图防抖
    /** @type {AntiFlapGuard} */
    this._antiFlap = new AntiFlapGuard();

    // 整理队列
    /** @type {Array} */
    this._orgQueue = [];
    /** @type {number} */
    this._orgIndex = 0;

    // 搜索结果
    /** @type {Array} */
    this._searchResults = [];

    // 冷启动窗口
    /** @type {number} */
    this._sessionStartTime = Date.now();
    /** @type {number} */
    this._coldStartWindow = opts.coldStartWindow || 5 * 60 * 1000;

    // 确认态暂存
    /** @type {Object|null} */
    this._pendingConfirmation = null;

    // CLOSING 路径字段暂存（#17）
    /** @type {Object|null} */
    this._pendingCollectedFields = null;

    // 定时器
    this._timer = null;
  }

  // ═══════════════════════════════════════════════════════════
  // 属性
  // ═══════════════════════════════════════════════════════════

  get state() { return this._state; }
  get prevState() { return this._prevState; }
  get fields() { return { ...this._fields }; }
  get isColdStart() { return (Date.now() - this._sessionStartTime) < this._coldStartWindow; }

  // ═══════════════════════════════════════════════════════════
  // 状态转换
  // ═══════════════════════════════════════════════════════════

  /**
   * 状态转换（内部），含合法性校验
   * @param {string} newState
   * @returns {boolean}
   */
  _transition(newState) {
    if (newState === this._state) return true;

    // 合法性校验：所有状态可转换到 IDLE/CLOSING
    const validTransitions = {
      [State.IDLE]:       [State.LISTENING],
      [State.LISTENING]:  [State.IDLE, State.ANALYZING, State.CLOSING],
      [State.ANALYZING]:  [State.LISTENING, State.RECORDING, State.SEARCHING, State.ORGANIZING, State.SETTING, State.CONFIRMING, State.IDLE, State.CLOSING],
      [State.RECORDING]:  [State.IDLE, State.VALIDATING, State.LISTENING, State.CLOSING],
      [State.SEARCHING]:  [State.IDLE, State.EXECUTING, State.LISTENING, State.CLOSING],
      [State.ORGANIZING]: [State.IDLE, State.EXECUTING, State.LISTENING, State.CLOSING],
      [State.SETTING]:    [State.IDLE, State.EXECUTING, State.CLOSING],
      [State.CONFIRMING]: [State.IDLE, State.LISTENING, State.RECORDING, State.SEARCHING, State.ORGANIZING, State.SETTING, State.CLOSING],
      [State.VALIDATING]: [State.IDLE, State.EXECUTING, State.RECORDING, State.CLOSING],
      [State.EXECUTING]:  [State.IDLE, State.CLOSING],
      [State.CLOSING]:    [State.IDLE],
    };

    const allowed = validTransitions[this._state] || [];
    if (!allowed.includes(newState)) {
      return false; // 非法转换，静默拒绝
    }

    this._prevState = this._state;
    this._state = newState;
    this._onStateChange(newState, this._prevState);
    return true;
  }

  /**
   * 强制状态转换（绕过合法性校验，仅用于紧急回退）
   * @param {string} newState
   */
  forceTransition(newState) {
    this._prevState = this._state;
    this._state = newState;
    this._onStateChange(newState, this._prevState);
  }

  // ═══════════════════════════════════════════════════════════
  // 输入处理
  // ═══════════════════════════════════════════════════════════

  /**
   * 处理用户输入，返回动作指令
   *
   * @param {string} text - 用户输入
   * @param {Object} [opts]
   * @param {Object} [opts.intentResult] - 外部意图识别结果 { intent, confidence, extracted }
   * @returns {Object} { action, reply, state, data }
   */
  async handleInput(text, opts = {}) {
    const t = (text || '').trim();

    // ── 口令层：退出/取消（全局优先级最高）──
    if (EXIT_WORDS.has(t)) {
      return this._handleExit();
    }

    if (CANCEL_WORDS.has(t) && this._state !== State.IDLE) {
      return this._handleCancel();
    }

    // ── 状态分发 ──
    switch (this._state) {
      case State.IDLE:      return this._handleIdle(t, opts);
      case State.LISTENING: return this._handleListening(t, opts);
      case State.ANALYZING: return this._handleAnalyzing(t, opts);
      case State.RECORDING: return this._handleRecording(t, opts);
      case State.SEARCHING: return this._handleSearching(t, opts);
      case State.ORGANIZING: return this._handleOrganizing(t, opts);
      case State.SETTING:   return this._handleSetting(t, opts);
      case State.CONFIRMING: return this._handleConfirming(t, opts);
      case State.VALIDATING: return this._handleValidating(t, opts);
      case State.EXECUTING: return this._handleExecuting(t, opts);
      case State.CLOSING:   return this._handleClosing(t, opts);
      default:
        this.forceTransition(State.IDLE);
        return { action: 'reset', reply: '', state: State.IDLE };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // IDLE
  // ═══════════════════════════════════════════════════════════

  _handleIdle(t) {
    // 冷启动窗口：接受更宽松的输入
    if (this.isColdStart && t.length > 1) {
      // 冷启动时直接进入 LISTENING
      // carry: this._fields (empty at cold start)
      this._transition(State.LISTENING);
      return {
        action: 'listen',
        reply: this.isColdStart ? '杂碎本在呢。想记什么？' : '',
        state: this._state,
        data: { input: t, isColdStart: true },
      };
    }

    // 正常口令匹配
    const pw = matchPassword(t);
    if (pw.wake) {
      const content = extractAfterWake(t);
      // carry: this._fields (fresh after wake)
      this._transition(State.LISTENING);
      return {
        action: 'listen',
        reply: content ? '' : '杂碎本在呢。想记什么？',
        state: this._state,
        data: { input: content || t, isColdStart: false },
      };
    }

    // 未唤醒
    return { action: 'idle', reply: '', state: this._state };
  }

  // ═══════════════════════════════════════════════════════════
  // LISTENING
  // ═══════════════════════════════════════════════════════════

  _handleListening(t, opts) {
    const result = opts.intentResult;
    if (!result) {
      return { action: 'needs_intent', reply: '', state: this._state, data: { input: t } };
    }

    const { intent, confidence } = result;

    // 意图防抖
    const flap = this._antiFlap.record(intent);
    if (flap.locked) {
      return {
        action: 'flap_locked',
        reply: `确定是要做${_intentLabel(flap.anchorIntent)}对吗？`,
        state: this._state,
        data: { anchorIntent: flap.anchorIntent },
      };
    }

    // 阈值判断
    if (confidence >= 80) {
      // 直发
      return this._dispatchIntent(intent, result);
    } else if (confidence >= 60) {
      // 确认
      this._pendingConfirmation = { intent, result };
      // carry: this._pendingConfirmation (set above); carry: this._fields (unchanged)
      this._transition(State.CONFIRMING);
      return {
        action: 'confirm',
        reply: `您是想要${_intentLabel(intent)}吗？`,
        state: this._state,
        data: { intent, confidence },
      };
    } else {
      // 引导
      return {
        action: 'guide',
        reply: '没听明白，请说"记一下"来记录，或"找XXX"来检索。',
        state: this._state,
        data: { intent, confidence },
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ANALYZING
  // ═══════════════════════════════════════════════════════════

  _handleAnalyzing(t, opts) {
    // 分析态通常是过渡态；外部 LLM 调用完成后应直接 dispatch
    if (opts.intentResult) {
      // N14 Case11: 冷启动后 confidence 硬拦截
      const { intent, confidence, reply } = opts.intentResult;
      if (!this.isColdStart && confidence < (this._tunables?.intent_confidence_confirm ?? 60) && _isHardConfirm(reply || '')) {
        return {
          action: 'confidence_blocked',
          reply: '你说的是这个意思吗？请再说一遍。',
          state: this._state,
          error_tag: 'confidence_blocked',
        };
      }
      return this._dispatchIntent(intent, opts.intentResult);
    }
    return { action: 'analyzing', reply: '…', state: this._state };
  }

  // ═══════════════════════════════════════════════════════════
  // RECORDING
  // ═══════════════════════════════════════════════════════════

  _handleRecording(t, opts) {
    // ═══ N14 Case11: 冷启动后 confidence 硬拦截 ═══
    if (!this.isColdStart && opts.intentResult) {
      const conf = opts.intentResult.confidence;
      const reply = opts.intentResult.reply || '';
      const threshold = this._tunables?.intent_confidence_confirm ?? 60;

      // 低置信度 + 硬撑式确认 → 拦截
      if (conf < threshold && _isHardConfirm(reply)) {
        return {
          action: 'confidence_blocked',
          reply: '你说的是这个意思吗？请再说一遍。',
          state: this._state,
          error_tag: 'confidence_blocked',
          askingField: 'content',
          ...(opts.intentResult?.changeLevel ? { changeLevel: opts.intentResult.changeLevel } : {}),
        };
      }
    }

    const extracted = opts.intentResult?.extracted || {};

    // 检查是否有完整字段
    if (opts.recordReady) {
      // 进入 DET 值域复验
      this._fields = {
        key: extracted.key || null,
        content: extracted.content || t,
        isTempKey: !extracted.key,
      };
      // carry: this._fields → clear on successful execution
      this._transition(State.VALIDATING);
      return {
        action: 'validate',
        reply: '',
        state: this._state,
        data: { fields: this._fields, ...(opts.intentResult?.changeLevel ? { changeLevel: opts.intentResult.changeLevel } : {}) },
      };
    }

    // 还需收集字段
    this._fields = {
      key: extracted.key || null,
      content: extracted.content || '',
      isTempKey: !extracted.key,
    };

    // 缺字段时引导追问
    if (!this._fields.content) {
      return {
        action: 'ask_field',
        reply: '想记什么？',
        state: this._state,
        askingField: 'content',
        ...(opts.intentResult?.changeLevel ? { changeLevel: opts.intentResult.changeLevel } : {}),
      };
    }

    return {
      action: 'collecting',
      reply: '这一条什么时候整理？比如说"明天"、"三天后"，或说"默认"。',
      state: this._state,
      askingField: 'time',
      ...(opts.intentResult?.changeLevel ? { changeLevel: opts.intentResult.changeLevel } : {}),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SEARCHING
  // ═══════════════════════════════════════════════════════════

  _handleSearching(t, opts) {
    const results = opts.searchResults || this._searchResults;

    if (!results || results.length === 0) {
      // clear: search state (no results)
      this._transition(State.IDLE);
      return { action: 'no_results', reply: '没找到相关记录。', state: this._state };
    }

    if (results.length === 1) {
      const r = results[0];
      // carry: search result → clear on exit
      this._transition(State.EXECUTING);
      return {
        action: 'search_done',
        reply: `找到了：${r.name || ''}——${r.content || ''}`,
        state: this._state,
        data: { record: r },
      };
    }

    // 多条 → 反问
    this._searchResults = results;
    return {
      action: 'search_multi',
      reply: `有几条相关记录，是昨天的还是哪一天的？`,
      state: this._state,
      data: { count: results.length },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ORGANIZING
  // ═══════════════════════════════════════════════════════════

  _handleOrganizing(t, opts) {
    const queue = opts.orgQueue || this._orgQueue;

    if (!queue.length || this._orgIndex >= queue.length) {
      // carry: org queue done → clear on exit
      this._transition(State.EXECUTING);
      return { action: 'org_done', reply: '整完了。', state: this._state };
    }

    const r = queue[this._orgIndex];
    const k = this._orgIndex + 1;
    const n = queue.length;
    const isTemp = r.isTemporary;

    // skipCount 自动废弃检查
    const autoDiscardThreshold = this._tunables.organize_skip_auto_discard || 3;
    if (isTemp && (r.skipCount || 0) >= autoDiscardThreshold) {
      // 自动废弃
      this._orgIndex++;
      return {
        action: 'org_auto_discard',
        reply: '这条已经多次跳过了，自动废弃。',
        state: this._state,
        data: { record: r, skipCount: r.skipCount },
      };
    }

    // 构建展示文本
    const displayText = isTemp
      ? `未整理（${k}/${n}）。${r.name}——${r.content || ''}。附件：${(r.attachments || []).length}个。这条还没有正式名字，要起一个吗？`
      : `未整理（${k}/${n}）。${r.name}——${r.content || ''}。附件：${(r.attachments || []).length}个。好了？`;

    return {
      action: 'org_show',
      reply: displayText,
      state: this._state,
      data: {
        record: r,
        index: k,
        total: n,
        isTemporary: isTemp,
        skipCount: r.skipCount || 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SETTING
  // ═══════════════════════════════════════════════════════════

  _handleSetting() {
    // carry: setting → clear on exit
    this._transition(State.EXECUTING);
    return {
      action: 'setting_done',
      reply: '请到设置页面修改提醒周期。',
      state: this._state,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CONFIRMING
  // ═══════════════════════════════════════════════════════════

  _handleConfirming(t, opts) {
    const tLower = t.toLowerCase();

    if (tLower === '是' || tLower === '对' || tLower === '是的' || tLower === '对呀' || tLower === '好') {
      // 用户确认 → 执行挂起的意图
      const pending = this._pendingConfirmation;
      this._pendingConfirmation = null;
      if (pending) {
        return this._dispatchIntent(pending.intent, pending.result);
      }
      // clear: _pendingConfirmation (no pending)
      this._transition(State.IDLE);
      return { action: 'confirmed_no_pending', reply: '好的。', state: this._state };
    }

    if (tLower === '不是' || tLower === '不对' || tLower === '不') {
      this._pendingConfirmation = null;
      // clear: _pendingConfirmation; carry: this._fields
      this._transition(State.LISTENING);
      return { action: 'rejected', reply: '那重新说吧。', state: this._state };
    }

    // 其他输入 → 当作新意图
    this._pendingConfirmation = null;
    // clear: _pendingConfirmation; carry: this._fields
    this._transition(State.LISTENING);
    return { action: 'new_input', reply: '', state: this._state, data: { input: t } };
  }

  // ═══════════════════════════════════════════════════════════
  // VALIDATING
  // ═══════════════════════════════════════════════════════════

  _handleValidating(t, opts) {
    const fields = opts.fields || this._fields;

    // ── DET: Key 格式校验（L3 check_key_has_noun）──
    // isTempKey===true 或未设置（兼容测试）时跳过 key 校验
    if (fields.isTempKey === false) {
      const key = fields.key;
      if (!key || !key.trim()) {
        // Key 为空
        // carry: this._fields → retry collection
        this._transition(State.RECORDING);
        return {
          action: 'validation_failed',
          error_tag: 'key_missing',
          reply: '记的什么？',
          state: this._state,
          data: { errors: ['记的什么？'], error_tag: 'key_missing' },
        };
      }
      const keyCheck = DET.checkKeyHasNoun(key);
      if (!keyCheck.valid) {
        // Key 不含名词
        // carry: this._fields → retry collection
        this._transition(State.RECORDING);
        return {
          action: 'validation_failed',
          error_tag: 'key_invalid',
          reply: '记得具体一点？',
          state: this._state,
          data: { errors: ['记得具体一点？'], error_tag: 'key_invalid' },
        };
      }
    }

    // ── DET: 内容长度 ──
    const maxLen = this._tunables.content_max_length || 5000;
    if (fields.content && fields.content.length > maxLen) {
      const msg = `内容太长了，请精简到 ${maxLen} 字以内`;
      // carry: this._fields → retry collection
      this._transition(State.RECORDING);
      return {
        action: 'validation_failed',
        error_tag: 'content_too_long',
        reply: msg,
        state: this._state,
        data: { errors: [msg], error_tag: 'content_too_long' },
      };
    }

    // ── DET: 附件数量校验 ──
    if (fields.attachments && fields.attachments.length > 0) {
      const maxAtt = this._tunables.attachment_max_count || 5;
      if (fields.attachments.length > maxAtt) {
        const msg = `附件数量超限（最多${maxAtt}个）`;
        // carry: this._fields → retry collection
        this._transition(State.RECORDING);
        return {
          action: 'validation_failed',
          error_tag: 'attachment_too_many',
          reply: msg,
          state: this._state,
          data: { errors: [msg], error_tag: 'attachment_too_many' },
        };
      }
    }

    // ── 校验通过 → EXECUTING ──
    // carry: this._fields → consumed on execution
    this._transition(State.EXECUTING);
    return {
      action: 'executing',
      reply: '',
      state: this._state,
      data: { fields: this._fields },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // EXECUTING
  // ═══════════════════════════════════════════════════════════

  _handleExecuting() {
    // 执行完毕 → 回到 IDLE
    // clear: this._fields (execution consumed)
    this._transition(State.IDLE);
    return {
      action: 'idle',
      reply: '',
      state: this._state,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CLOSING
  // ═══════════════════════════════════════════════════════════

  _handleClosing() {
    // #17 CLOSING 路径字段暂存：退出前若有非临时 key 的未完成字段，暂存供后续恢复
    if (this._fields && this._fields.key && !this._fields.isTempKey) {
      this._pendingCollectedFields = { ...this._fields };
    }
    // 已在 CLOSING，2s 后自动回 IDLE
    return { action: 'closing', reply: '', state: this._state };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部辅助
  // ═══════════════════════════════════════════════════════════

  /**
   * 分发意图到对应子状态
   */
  _dispatchIntent(intent, result) {
    const extracted = result.extracted || {};

    switch (intent) {
      case 'record':
        this._fields = {
          key: extracted.key || null,
          content: extracted.content || '',
          isTempKey: !extracted.key,
        };
        // carry: this._fields (newly populated)
        this._transition(State.RECORDING);
        return {
          action: 'recording',
          reply: (extracted.content && extracted.contentValid !== false) ? '这一条什么时候整理？' : '想记什么？',
          state: this._state,
          data: { fields: this._fields, askingField: extracted.content ? 'time' : 'content' },
        };

      case 'search':
        this._searchResults = [];
        // carry: search state (fresh)
        this._transition(State.SEARCHING);
        return {
          action: 'searching',
          reply: extracted.key ? '' : '想找什么？',
          state: this._state,
          data: { searchKey: extracted.key || '', askingField: 'search_key' },
        };

      case 'organize':
        this._orgQueue = [];
        this._orgIndex = 0;
        // carry: org queue (fresh, empty until populated)
        this._transition(State.ORGANIZING);
        return {
          action: 'organizing',
          reply: '',
          state: this._state,
          data: { needsQueue: true },
        };

      case 'setting':
        // carry: setting → delegates to _handleSetting
        this._transition(State.SETTING);
        return this._handleSetting();

      default: // 'other'
        // clear: unrecognized intent → return to idle
        this._transition(State.IDLE);
        return {
          action: 'other',
          reply: '没听明白，请说"杂碎本，记一下"来记录碎片信息，或者说"找XXX"来检索已有记录。',
          state: this._state,
        };
    }
  }

  _handleExit() {
    this._clearTimer();
    // carry: this._fields → persist to _pendingCollectedFields (see _handleClosing)
    this._transition(State.CLOSING);
    // 2 秒后自动回 IDLE
    this._timer = setTimeout(() => {
      if (this._state === State.CLOSING) {
        // clear: all state (close complete)
        this._transition(State.IDLE);
      }
    }, 2000);
    return { action: 'exit', reply: '好的，拜拜。', state: this._state };
  }

  _handleCancel() {
    this._clearTimer();
    this._fields = {};
    this._pendingConfirmation = null;
    this.forceTransition(State.IDLE);
    return { action: 'cancel', reply: '好的。', state: this._state };
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 公共方法
  // ═══════════════════════════════════════════════════════════

  /**
   * 直接进入某状态（外部触发）
   * @param {string} targetState
   * @param {Object} [data]
   */
  enterState(targetState, data = {}) {
    if (data.fields) this._fields = data.fields;
    if (data.orgQueue) this._orgQueue = data.orgQueue;
    if (data.orgIndex != null) this._orgIndex = data.orgIndex;
    if (data.searchResults) this._searchResults = data.searchResults;

    return this._transition(targetState);
  }

  /**
   * 整理：前进到下一条
   * @returns {Object}
   */
  advanceOrganize() {
    this._orgIndex++;
    return this._handleOrganizing('', {});
  }

  /**
   * 整理：增加 skipCount
   * @param {string} id - 记录 ID
   * @returns {{ skipCount: number, autoDiscard: boolean }}
   */
  incrementSkipCount(id) {
    const r = this._orgQueue[this._orgIndex];
    if (!r || r.id !== id) return { skipCount: 0, autoDiscard: false };

    const newCount = (r.skipCount || 0) + 1;
    r.skipCount = newCount;

    const threshold = this._tunables.organize_skip_auto_discard || 3;
    const autoDiscard = newCount >= threshold;

    if (autoDiscard) {
      this._orgIndex++;
    }

    return { skipCount: newCount, autoDiscard };
  }

  /**
   * 设置搜索结果
   * @param {Array} results
   */
  setSearchResults(results) {
    this._searchResults = results || [];
  }

  /**
   * 设置整理队列
   * @param {Array} queue
   */
  setOrgQueue(queue) {
    this._orgQueue = queue || [];
    this._orgIndex = 0;
  }

  /**
   * 重置状态机
   */
  reset() {
    this._clearTimer();
    this._state = State.IDLE;
    this._prevState = null;
    this._fields = {};
    this._antiFlap.reset();
    this._orgQueue = [];
    this._orgIndex = 0;
    this._searchResults = [];
    this._pendingConfirmation = null;
    this._pendingCollectedFields = null;
    this._sessionStartTime = Date.now();
  }

  /**
   * 获取当前状态快照（用于 N6 传递协议）
   * @returns {Object}
   */
  snapshot() {
    return {
      state: this._state,
      prevState: this._prevState,
      fields: { ...this._fields },
      orgQueue: [...this._orgQueue],
      orgIndex: this._orgIndex,
      searchResults: [...this._searchResults],
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function _intentLabel(intent) {
  const m = { record: '记录', search: '检索', organize: '整理', setting: '设置', other: '其他' };
  return m[intent] || intent;
}

// ═══════════════════════════════════════════════════════════
// N14 Case11: confidence 硬拦截辅助
// ═══════════════════════════════════════════════════════════

const HARD_CONFIRM_PATTERNS = [
  '好的', '嗯', '记好了', '记下了', '可以', '好了', 'ok', '好了已经',
  '已完成', '保存了', '存好了', '没问题', '明白了', '知道了',
];

/**
 * 检测 LLM 回复是否为"硬撑式确认"（低置信度下的虚假确认）
 * @param {string} text
 * @returns {boolean}
 */
function _isHardConfirm(text) {
  if (!text || typeof text !== 'string') return false;
  // 短回复 + 不含实质内容 → 可能是在硬撑
  if (text.length < 10 && !/\w{3,}/.test(text)) return true;
  // 匹配硬撑式确认模式
  const clean = text.replace(/[，。！？,.!?\s]/g, '');
  return HARD_CONFIRM_PATTERNS.some(p => clean === p || clean.startsWith(p));
}
