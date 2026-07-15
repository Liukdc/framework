// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * turnType 统一 Schema — 杂碎本 v3.0
 *
 * 基于 L3 turnType-schema.json，提供 TurnType / ChangeLevel / AskingField 枚举、
 * turn 校验与构造、changeLevelDefaults 处理。
 *
 * @module zacuiben/turnType
 */

// ═══════════════════════════════════════════════════════════
// 枚举
// ═══════════════════════════════════════════════════════════

/** 轮次类型 — 六值 */
export const TurnType = Object.freeze({
  ASK:               'ask',
  REPLY:             'reply',
  COMPLETE:          'complete',
  OFF_TASK:          'off-task',
  GIVEUP:            'giveup',
  VALIDATION_FAILED: 'validation_failed',
});

/** 变更级别 */
export const ChangeLevel = Object.freeze({
  MAJOR:   'major',
  MINOR:   'minor',
  INVALID: 'invalid',
});

/** field_based 模式下可追问字段 */
export const AskingField = Object.freeze({
  INTENT:          'intent',
  KEY:             'key',
  CONTENT:         'content',
  ATTACHMENT:      'attachment',
  TIME:            'time',
  SEARCH_KEY:      'search_key',
  ORGANIZE_ACTION: 'organize_action',
});

// ═══════════════════════════════════════════════════════════
// changeLevel 默认值
// ═══════════════════════════════════════════════════════════

/** changeLevel 默认值常量 */
export const changeLevelDefaults = Object.freeze({
  /** 格式错误默认归类为 minor */
  formatError: ChangeLevel.MINOR,

  /** changeLevelReason 默认值 */
  changeLevelReasonDefault: '未提供',

  /** 空值/超长 -> DET 拦截 + 默认"未提供" + 记录警告 */
  onEmptyOrOverlength: 'DET 拦截+默认"未提供"+记录警告',
});

// ═══════════════════════════════════════════════════════════
// 合法值集合（O(1) 查找）
// ═══════════════════════════════════════════════════════════

const VALID_TURN_TYPES = new Set(Object.values(TurnType));
const VALID_CHANGE_LEVELS = new Set(Object.values(ChangeLevel));
const VALID_ASKING_FIELDS = new Set(Object.values(AskingField));

// ═══════════════════════════════════════════════════════════
// turn 校验
// ═══════════════════════════════════════════════════════════

/**
 * 校验一个 turn 对象是否符合 Schema
 *
 * @param {Object} turn - 待校验的 turn 对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTurn(turn) {
  const errors = [];

  if (!turn || typeof turn !== 'object') {
    return { valid: false, errors: ['turn 必须是非 null 对象'] };
  }

  // turnType 必填且必须为六值之一
  if (!turn.turnType) {
    errors.push('turnType 是必填字段');
  } else if (!VALID_TURN_TYPES.has(turn.turnType)) {
    errors.push(`turnType 必须为六值之一: ${[...VALID_TURN_TYPES].join('/')}`);
  }

  // askingField 可为 null，非 null 时必须为合法值
  if (turn.askingField != null && !VALID_ASKING_FIELDS.has(turn.askingField)) {
    errors.push(`askingField 必须为合法值: ${[...VALID_ASKING_FIELDS].join('/')}`);
  }

  // changeLevel 必填且必须为三值之一
  if (!turn.changeLevel) {
    errors.push('changeLevel 是必填字段');
  } else if (!VALID_CHANGE_LEVELS.has(turn.changeLevel)) {
    errors.push(`changeLevel 必须为三值之一: ${[...VALID_CHANGE_LEVELS].join('/')}`);
  }

  // changeLevelReason：major/minor 时必填，长度 ≤100
  if (turn.changeLevel === ChangeLevel.MAJOR || turn.changeLevel === ChangeLevel.MINOR) {
    if (!turn.changeLevelReason || !turn.changeLevelReason.trim()) {
      errors.push('changeLevel 为 major/minor 时 changeLevelReason 必填');
    } else if (turn.changeLevelReason.length > 100) {
      errors.push('changeLevelReason 最大长度 100 字符');
    }
  }

  // message：30 字以内
  if (turn.message != null && turn.message.length > 30) {
    errors.push('message 最大长度 30 字符');
  }

  // collectedFields：如存在必须为普通对象
  if (turn.collectedFields != null && (typeof turn.collectedFields !== 'object' || Array.isArray(turn.collectedFields))) {
    errors.push('collectedFields 必须为普通对象');
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════
// turn 构造工厂
// ═══════════════════════════════════════════════════════════

/**
 * 构造一个合规的 turn 对象，自动填充默认值
 *
 * @param {Object} opts
 * @param {string} opts.turnType         - 必填，六值之一
 * @param {string|null} [opts.askingField=null] - 追问字段
 * @param {string} [opts.changeLevel]     - 变更级别
 * @param {string} [opts.changeLevelReason] - 变更原因
 * @param {string} [opts.message]         - 回复文本
 * @param {Object} [opts.collectedFields] - 本轮有变化的字段
 * @returns {Object} 完整 turn 对象
 */
export function createTurn(opts = {}) {
  const turnType = opts.turnType;
  if (!turnType || !VALID_TURN_TYPES.has(turnType)) {
    throw new Error(`createTurn: turnType 必须为六值之一，收到: ${turnType}`);
  }

  const changeLevel = opts.changeLevel || ChangeLevel.MINOR;
  if (!VALID_CHANGE_LEVELS.has(changeLevel)) {
    throw new Error(`createTurn: changeLevel 必须为三值之一，收到: ${changeLevel}`);
  }

  // changeLevelReason 默认值处理
  let changeLevelReason = opts.changeLevelReason;
  if ((changeLevel === ChangeLevel.MAJOR || changeLevel === ChangeLevel.MINOR) && !changeLevelReason) {
    changeLevelReason = changeLevelDefaults.changeLevelReasonDefault;
  }

  const turn = {
    turnType,
    askingField: opts.askingField || null,
    changeLevel,
    changeLevelReason: changeLevelReason || null,
    message: (opts.message || '').substring(0, 30),
    collectedFields: opts.collectedFields || {},
  };

  return turn;
}

/**
 * 创建 validation_failed turn
 *
 * @param {string} reason - 失败原因
 * @param {string} [message] - 用户可见消息
 * @param {string} [error_tag] - L3 error_tag 标识符
 * @returns {Object}
 */
export function createValidationFailed(reason, message, error_tag) {
  const turn = createTurn({
    turnType: TurnType.VALIDATION_FAILED,
    changeLevel: ChangeLevel.INVALID,
    changeLevelReason: reason,
    message: message || '内容格式不符合要求',
  });
  if (error_tag) {
    turn.error_tag = error_tag;
  }
  return turn;
}

/**
 * 确认 changeLevel 是否合法
 * @param {string} level
 * @returns {boolean}
 */
export function isValidChangeLevel(level) {
  return VALID_CHANGE_LEVELS.has(level);
}

/**
 * 确认 turnType 是否合法
 * @param {string} type
 * @returns {boolean}
 */
export function isValidTurnType(type) {
  return VALID_TURN_TYPES.has(type);
}
