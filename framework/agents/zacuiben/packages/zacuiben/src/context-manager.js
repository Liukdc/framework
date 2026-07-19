// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 上下文管理器 — 杂碎本 v3.0
 *
 * 复用富贵小安 context-manager v1.1 规范，适配杂碎本 field_based 场景。
 * 提供：buildPromptContext / updateGraph / injectOffTaskSuspicion /
 *       fieldLevelHardGate（字段级硬门控） / _scoreMatch（中文 bigram Jaccard）。
 *
 * @module zacuiben/context-manager
 */

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

/** 轮次历史保留上限（可通过 tunables 调整） */
const DEFAULT_TURN_HISTORY_LIMIT = 20;

/** 各 intent 对应的上下文截断规则 */
const INTENT_TRUNCATION = Object.freeze({
  record:    { turnHistory: 5,  maxChars: 2000 },
  search:    { turnHistory: 3,  maxChars: 500 },
  organize:  { turnHistory: 2,  maxChars: 500 },
  setting:   { turnHistory: 3,  maxChars: 500 },
  other:     { turnHistory: 3,  maxChars: 500 },
  'intent-recognition': { turnHistory: 1, maxChars: 300 },
});

/** off-task 检测阈值：中文 bigram Jaccard < 此值时标记为可能偏离 */
const OFF_TASK_SIMILARITY_THRESHOLD = 0.1;

// ═══════════════════════════════════════════════════════════
// 中文 bigram Jaccard 相似度
// ═══════════════════════════════════════════════════════════

/**
 * 将文本拆为中文 bigram 集合
 * @param {string} text
 * @returns {Set<string>}
 */
function _toBigrams(text) {
  const cleaned = (text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const bigrams = new Set();
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.substring(i, i + 2));
  }
  return bigrams;
}

/**
 * 计算两个文本的中文 bigram Jaccard 相似度
 *
 * Jaccard = |A ∩ B| / |A ∪ B|
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 0-1 之间的相似度
 */
export function _scoreMatch(textA, textB) {
  const a = _toBigrams(textA);
  const b = _toBigrams(textB);

  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const bigram of a) {
    if (b.has(bigram)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ═══════════════════════════════════════════════════════════
// 字段级硬门控
// ═══════════════════════════════════════════════════════════

/**
 * 字段白名单 — field_based 模式下允许出现的字段
 * 非白名单字段在硬门控中直接拦截
 */
const FIELD_WHITELIST = new Set([
  'intent',
  'key',
  'content',
  'attachment',
  'time',
  'search_key',
  'organize_action',
  'confidence',
  'turnType',
  'changeLevel',
  'changeLevelReason',
  'message',
  'collectedFields',
  'extracted',
]);

/**
 * 字段级硬门控：检查输出中是否包含非白名单字段
 *
 * @param {Object} output - turn 输出对象
 * @param {Object} [opts]
 * @param {Set<string>} [opts.extraAllowed] - 额外允许的字段
 * @returns {{ allowed: boolean, blockedFields: string[] }}
 */
export function fieldLevelHardGate(output, opts = {}) {
  if (!output || typeof output !== 'object') {
    return { allowed: false, blockedFields: ['(invalid output)'] };
  }

  const allowed = new Set([...FIELD_WHITELIST, ...(opts.extraAllowed || [])]);
  const blocked = [];

  // 检查 collectedFields 内部的字段
  function checkFields(obj, path) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (!allowed.has(key)) {
        blocked.push(fullPath);
      }
      // 递归检查嵌套对象（但不检查数组内部）
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        checkFields(obj[key], fullPath);
      }
    }
  }

  checkFields(output, '');
  // 过滤 collectedFields / extracted 这种顶层容器字段
  const realBlocked = blocked.filter(f => f !== 'collectedFields' && f !== 'extracted');

  return { allowed: realBlocked.length === 0, blockedFields: realBlocked };
}

// ═══════════════════════════════════════════════════════════
// 上下文管理器
// ═══════════════════════════════════════════════════════════

export class ContextManager {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.turnHistoryLimit=20] - 轮次历史保留上限
   */
  constructor(opts = {}) {
    /** @type {Array<{role:string, content:string, turnType?:string, intent?:string}>} */
    this._turnHistory = [];
    /** @type {number} */
    this._turnHistoryLimit = opts.turnHistoryLimit || DEFAULT_TURN_HISTORY_LIMIT;
    /** off-task 可疑度计数 */
    this._offTaskSuspicionCount = 0;
  }

  // ═══════════════════════════════════════════════════════
  // 公开 API
  // ═══════════════════════════════════════════════════════════

  /**
   * 构建 LLM prompt 上下文（基于当前 intent + 历史轮次）
   *
   * 根据意图的 @importance 截断规则裁剪上下文：
   * - record: 最近 5 轮
   * - search: 最近 3 轮
   * - organize: 最近 2 轮
   * - 其他: 最近 3 轮
   *
   * @param {string} intent - 当前意图
   * @param {Object} [opts]
   * @param {string} [opts.currentInput] - 当前用户输入
   * @param {Object} [opts.fields] - 当前已收集字段
   * @param {Object} [opts.tunables] - 可调参数
   * @returns {Object} { systemPrompt, userMessage, history }
   */
  buildPromptContext(intent, opts = {}) {
    const trunc = INTENT_TRUNCATION[intent] || INTENT_TRUNCATION.other;
    const history = this._turnHistory.slice(-trunc.turnHistory);

    // 截断字符数
    let historyText = '';
    for (const h of history) {
      const chunk = `${h.role}: ${(h.content || '').substring(0, trunc.maxChars)}`;
      if ((historyText.length + chunk.length) > trunc.maxChars) break;
      historyText += chunk + '\n';
    }

    const currentInput = opts.currentInput || '';
    const fields = opts.fields || {};

    return {
      intent,
      history,
      currentInput,
      fields,
      tunables: opts.tunables || {},
    };
  }

  /**
   * 更新上下文图（追加轮次到历史）—— L2 标准接口 updateGraph
   *
   * @param {string} role - 'user' | 'assistant' | 'system'
   * @param {string} content - 消息内容
   * @param {Object} [meta] - 元数据（turnType, intent, askingField, changeLevel, changeLevelReason 等）
   */
  updateGraph(role, content, meta = {}) {
    this._turnHistory.push({
      role,
      content: content || '',
      turnType: meta.turnType || null,
      intent: meta.intent || null,
      askingField: meta.askingField || null,
      changeLevel: meta.changeLevel || null,
      changeLevelReason: meta.changeLevelReason || null,
      timestamp: new Date().toISOString(),
    });

    // 保留最近 N 轮
    if (this._turnHistory.length > this._turnHistoryLimit) {
      this._turnHistory = this._turnHistory.slice(-this._turnHistoryLimit);
    }
  }

  /**
   * 注入 off-task 嫌疑检测
   *
   * 将当前输入与上下文中的任务描述进行 bigram Jaccard 比较。
   * 相似度过低 → 标记为可能偏离。
   *
   * @param {string} currentInput - 当前用户输入
   * @param {string} taskDescription - 当前任务描述（如 "record=录入"）
   * @returns {{ suspicious: boolean, score: number, count: number }}
   */
  injectOffTaskSuspicion(currentInput, taskDescription) {
    const score = _scoreMatch(currentInput, taskDescription);

    if (score < OFF_TASK_SIMILARITY_THRESHOLD) {
      this._offTaskSuspicionCount++;
    } else {
      // 回归正常 → 重置计数
      if (this._offTaskSuspicionCount > 0 && score >= OFF_TASK_SIMILARITY_THRESHOLD * 2) {
        this._offTaskSuspicionCount = 0;
      }
    }

    return {
      suspicious: score < OFF_TASK_SIMILARITY_THRESHOLD,
      score,
      count: this._offTaskSuspicionCount,
    };
  }

  /**
   * 获取轮次历史
   * @param {number} [n] - 最近 N 轮，默认全部
   * @returns {Array<Object>}
   */
  getHistory(n) {
    if (n != null && n > 0) {
      return this._turnHistory.slice(-n);
    }
    return [...this._turnHistory];
  }

  /**
   * 获取 off-task 嫌疑累计次数
   * @returns {number}
   */
  getOffTaskCount() {
    return this._offTaskSuspicionCount;
  }

  /**
   * 重置 off-task 嫌疑计数
   */
  resetOffTaskSuspicion() {
    this._offTaskSuspicionCount = 0;
  }

  /**
   * 清空轮次历史
   */
  clear() {
    this._turnHistory = [];
    this._offTaskSuspicionCount = 0;
  }

  /**
   * 设置轮次历史上限
   * @param {number} n
   */
  setTurnHistoryLimit(n) {
    this._turnHistoryLimit = Math.max(1, Math.min(n, 100));
    if (this._turnHistory.length > this._turnHistoryLimit) {
      this._turnHistory = this._turnHistory.slice(-this._turnHistoryLimit);
    }
  }

  /**
   * 统计轮次
   * @returns {{ total: number, byRole: Object }}
   */
  stats() {
    const byRole = {};
    for (const h of this._turnHistory) {
      byRole[h.role] = (byRole[h.role] || 0) + 1;
    }
    return { total: this._turnHistory.length, byRole };
  }
}
