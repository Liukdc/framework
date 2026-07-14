// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * turnType 枚举与验证 — 基于 L3 turnType-schema.json 统一格式
 *
 * 适用于 field_based 和 topic_based 两种 taskType。
 * 包含 changeLevel + changeLevelReason 字段。
 *
 * @module fugui-xiaoan/turnType
 */

// ═══ turnType 枚举 ═══════════════════════
export const TurnType = Object.freeze({
  ASK:                'ask',
  REPLY:              'reply',
  COMPLETE:           'complete',
  OFF_TASK:           'off-task',
  GIVEUP:             'giveup',
  VALIDATION_FAILED:  'validation_failed',
});

// ═══ changeLevel 枚举 ═══════════════════════
export const ChangeLevel = Object.freeze({
  MAJOR:   'major',
  MINOR:   'minor',
  INVALID: 'invalid',
});

// ═══ askingField 有效值（仅 field_based record 环节使用） ═══
export const AskingField = Object.freeze({
  CATEGORY: 'category',
  AMOUNT:   'amount',
  TIME:     'time',
  QUANTITY: 'quantity',
});

// ═══ 有效 turnType 集合 ═══════════════════
const VALID_TURN_TYPES = new Set(Object.values(TurnType));
const VALID_CHANGE_LEVELS = new Set(Object.values(ChangeLevel));
const VALID_ASKING_FIELDS = new Set(Object.values(AskingField));

// ═══ 验证函数 ═══════════════════════════

/**
 * 验证 turnType 值是否合法。
 * @param {string} val
 * @returns {boolean}
 */
export function isValidTurnType(val) {
  return VALID_TURN_TYPES.has(val);
}

/**
 * 验证 changeLevel 值是否合法。
 * @param {string|null} val
 * @returns {boolean}
 */
export function isValidChangeLevel(val) {
  if (val === null || val === undefined) return true;
  return VALID_CHANGE_LEVELS.has(val);
}

/**
 * 验证 askingField 值是否合法（仅 record 环节）。
 * @param {string|null} val
 * @returns {boolean}
 */
export function isValidAskingField(val) {
  if (val === null || val === undefined) return true;
  return VALID_ASKING_FIELDS.has(val);
}

/**
 * 根据 L3 turnType-schema 验证一个完整的 turn 对象。
 *
 * @param {object} turn - 待验证的 turn 对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTurn(turn) {
  const errors = [];

  if (!turn || typeof turn !== 'object') {
    return { valid: false, errors: ['turn must be an object'] };
  }

  // turnType 必填
  if (!turn.turnType || !isValidTurnType(turn.turnType)) {
    errors.push(`Invalid turnType: "${turn.turnType}". Must be one of: ${Object.values(TurnType).join(', ')}`);
  }

  // askingField: record 环节可填，validation_failed 时为失败字段名
  if (turn.askingField !== undefined && turn.askingField !== null) {
    if (!isValidAskingField(turn.askingField)) {
      errors.push(`Invalid askingField: "${turn.askingField}". Must be one of: ${Object.values(AskingField).join(', ')}`);
    }
  }

  // changeLevel (L3 新增：适用于所有 taskType)
  if (turn.changeLevel !== undefined && turn.changeLevel !== null) {
    if (!isValidChangeLevel(turn.changeLevel)) {
      errors.push(`Invalid changeLevel: "${turn.changeLevel}". Must be one of: ${Object.values(ChangeLevel).join(', ')}`);
    }
  }

  // changeLevelReason: major/minor 必填 1-100 字
  if (turn.changeLevel === ChangeLevel.MAJOR || turn.changeLevel === ChangeLevel.MINOR) {
    if (!turn.changeLevelReason || typeof turn.changeLevelReason !== 'string') {
      errors.push('changeLevelReason is required for major/minor changeLevel');
    } else if (turn.changeLevelReason.length === 0 || turn.changeLevelReason.length > 100) {
      errors.push('changeLevelReason must be 1-100 characters');
    }
  }

  // message 最长 30 字
  if (turn.message && typeof turn.message === 'string' && turn.message.length > 30) {
    errors.push(`message exceeds 30 char limit (${turn.message.length})`);
  }

  // validationResult: turnType=validation_failed 时必填
  if (turn.turnType === TurnType.VALIDATION_FAILED) {
    if (!turn.validationResult || typeof turn.validationResult !== 'object') {
      errors.push('validationResult is required when turnType=validation_failed');
    } else {
      if (!turn.validationResult.field) errors.push('validationResult.field is required');
      if (!turn.validationResult.issue) errors.push('validationResult.issue is required');
    }
  }

  // offTaskInput: turnType=off-task 时必填
  if (turn.turnType === TurnType.OFF_TASK) {
    if (!turn.offTaskInput && turn.offTaskInput !== '') {
      errors.push('offTaskInput is required when turnType=off-task');
    }
  }

  // result: turnType=complete 时推荐填写
  if (turn.turnType === TurnType.COMPLETE && turn.result === undefined) {
    // 警告但不报错——某些环节 complete 可无 result
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 创建标准 turn 对象（带默认值）。
 *
 * @param {object} opts
 * @param {string} opts.turnType
 * @param {string} [opts.message='']
 * @param {string|null} [opts.askingField=null]
 * @param {string|null} [opts.changeLevel=null]
 * @param {string|null} [opts.changeLevelReason=null]
 * @param {object|null} [opts.validationResult=null]
 * @param {object} [opts.collectedFields={}]
 * @param {string|null} [opts.offTaskInput=null]
 * @param {object|null} [opts.result=null]
 * @returns {object}
 */
export function createTurn({
  turnType,
  message = '',
  askingField = null,
  changeLevel = null,
  changeLevelReason = null,
  validationResult = null,
  collectedFields = {},
  offTaskInput = null,
  result = null,
}) {
  return Object.freeze({
    turnType,
    askingField,
    changeLevel,
    changeLevelReason: changeLevelReason || (changeLevel && changeLevel !== ChangeLevel.INVALID ? 'not provided' : null),
    message: message || '',
    validationResult,
    collectedFields: collectedFields || {},
    offTaskInput,
    result,
  });
}

export default TurnType;
