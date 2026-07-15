// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * tunables — 杂碎本 v3.0 可调参数
 *
 * 基于 L3 tunables.json 12 参数。所有参数均为数值型，无字符串范围。
 * 提供 getTunable / setTunable / detectConflicts。
 *
 * @module zacuiben/tunables
 */

// ═══════════════════════════════════════════════════════════
// 参数定义（基于 L3 tunables.json）
// ═══════════════════════════════════════════════════════════

/** @type {Array<{name:string, defaultValue:number, valueRange:[number,number], purpose:string, consumer:string, crossCheck?:string}>} */
const PARAM_DEFS = Object.freeze([
  {
    name: 'intent_confidence_direct',
    defaultValue: 80,
    valueRange: [50, 100],
    purpose: '意图识别直发阈值（≥此值直接分发）',
    consumer: 'intent-recognition',
  },
  {
    name: 'intent_confidence_confirm',
    defaultValue: 60,
    valueRange: [30, 80],
    purpose: '意图识别确认阈值（≥此值反问确认，<此值引导）',
    consumer: 'intent-recognition',
    crossCheck: 'intent_confidence_confirm < intent_confidence_direct',
  },
  {
    name: 'content_max_length',
    defaultValue: 5000,
    valueRange: [500, 50000],
    purpose: '记录内容最大字数',
    consumer: 'record-session DET',
  },
  {
    name: 'attachment_max_count',
    defaultValue: 5,
    valueRange: [0, 20],
    purpose: '单条记录附件数量上限',
    consumer: 'record-session DET',
  },
  {
    name: 'attachment_image_max_mb',
    defaultValue: 10,
    valueRange: [1, 100],
    purpose: '图片附件大小上限（MB）',
    consumer: 'record-session DET',
  },
  {
    name: 'attachment_video_max_mb',
    defaultValue: 100,
    valueRange: [10, 1000],
    purpose: '视频附件大小上限（MB）',
    consumer: 'record-session DET',
  },
  {
    name: 'attachment_audio_max_mb',
    defaultValue: 50,
    valueRange: [1, 500],
    purpose: '音频附件大小上限（MB）',
    consumer: 'record-session DET',
  },
  {
    name: 'organize_default_days',
    defaultValue: 7,
    valueRange: [1, 90],
    purpose: '整理时间默认天数（无明确时间时）',
    consumer: 'record-session DET',
  },
  {
    name: 'organize_skip_auto_discard',
    defaultValue: 3,
    valueRange: [1, 10],
    purpose: '连续跳过次数≥此值自动废弃',
    consumer: 'organize-session DET',
  },
  {
    name: 'search_timeout_seconds',
    defaultValue: 10,
    valueRange: [3, 60],
    purpose: '搜索确认超时（秒）',
    consumer: 'search-session',
  },
  {
    name: 'turnHistory_limit',
    defaultValue: 20,
    valueRange: [5, 100],
    purpose: '会话轮次历史保留上限',
    consumer: 'context-manager',
  },
  {
    name: 'pending_fields_ttl',
    defaultValue: 86400,
    valueRange: [3600, 604800],
    purpose: '偏离时暂存半成品字段的保留时长（秒）',
    consumer: 'session-store',
  },
]);

// ═══════════════════════════════════════════════════════════
// 冲突规则（基于 L3 tunables.json）
// ═══════════════════════════════════════════════════════════

const CONFLICT_RULES = Object.freeze({
  single_param: [
    {
      name: 'intent_confidence_range',
      check: (params) => params.intent_confidence_direct > params.intent_confidence_confirm,
      description: 'intent_confidence_direct 必须大于 intent_confidence_confirm',
    },
  ],
  cross_param: [
    {
      name: 'attachment_total_budget',
      violation_action: 'warning',
      params: ['attachment_max_count', 'attachment_image_max_mb', 'attachment_video_max_mb', 'attachment_audio_max_mb'],
      check: (params) => {
        const budget = (params.attachment_max_count || 5) * 10
          + (params.attachment_video_max_mb || 100) * 100
          + (params.attachment_audio_max_mb || 50) * 50;
        return budget <= 2000;
      },
      description: '总附件存储量 = 图片×10 + 视频×100 + 音频×50 ≤ 2000MB',
    },
  ],
});

// ═══════════════════════════════════════════════════════════
// 运行时参数存储
// ═══════════════════════════════════════════════════════════

/**
 * 获取参数定义索引（按名称）
 * @returns {Map<string, Object>}
 */
function _buildDefIndex() {
  const idx = new Map();
  for (const def of PARAM_DEFS) {
    idx.set(def.name, def);
  }
  return idx;
}

const DEF_INDEX = _buildDefIndex();

/**
 * 获取可调参数的当前值
 *
 * @param {Object} state - 运行时参数状态对象
 * @param {string} name - 参数名
 * @returns {number} 参数值（未设置则返回默认值）
 */
export function getTunable(state, name) {
  const def = DEF_INDEX.get(name);
  if (!def) {
    throw new Error(`getTunable: 未知参数 "${name}"`);
  }
  if (state && typeof state === 'object' && Object.prototype.hasOwnProperty.call(state, name)) {
    return state[name];
  }
  return def.defaultValue;
}

/**
 * 设置可调参数的值（含范围校验）
 *
 * @param {Object} state - 运行时参数状态对象（将被原地修改）
 * @param {string} name - 参数名
 * @param {number} value - 新值
 * @returns {{ success: boolean, error?: string, value?: number }}
 */
export function setTunable(state, name, value) {
  const def = DEF_INDEX.get(name);
  if (!def) {
    return { success: false, error: `未知参数 "${name}"` };
  }

  if (typeof value !== 'number' || isNaN(value)) {
    return { success: false, error: `参数 "${name}" 必须是数值，收到: ${typeof value}` };
  }

  const [min, max] = def.valueRange;
  if (value < min || value > max) {
    return { success: false, error: `参数 "${name}" 超出范围 [${min}, ${max}]，收到: ${value}` };
  }

  state[name] = value;
  return { success: true, value };
}

/**
 * 检测参数冲突
 *
 * @param {Object} state - 运行时参数状态对象
 * @returns {{ conflicts: Array<{name:string, severity:'error'|'warning', description:string}> }}
 */
export function detectConflicts(state) {
  const conflicts = [];
  const params = {};

  // 构建完整参数快照（默认值 + 自定义值）
  for (const def of PARAM_DEFS) {
    params[def.name] = Object.prototype.hasOwnProperty.call(state, def.name)
      ? state[def.name]
      : def.defaultValue;
  }

  // 单参数冲突 -> hard_reject (error)
  for (const rule of CONFLICT_RULES.single_param) {
    if (!rule.check(params)) {
      conflicts.push({
        name: rule.name,
        severity: 'error',
        description: rule.description || `单参数约束违反: ${rule.name}`,
      });
    }
  }

  // 跨参数冲突 -> warning
  for (const rule of CONFLICT_RULES.cross_param) {
    if (!rule.check(params)) {
      conflicts.push({
        name: rule.name,
        severity: 'warning',
        description: rule.description || `跨参数约束违反: ${rule.name}`,
      });
    }
  }

  return { conflicts };
}

/**
 * 获取所有参数定义（只读）
 * @returns {Array<Object>}
 */
export function getAllParamDefs() {
  return [...PARAM_DEFS];
}

/**
 * 根据参数名获取其定义
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getParamDef(name) {
  return DEF_INDEX.get(name);
}

/**
 * 构建参数默认值快照
 * @returns {Object} 所有参数的默认值键值对
 */
export function createDefaultState() {
  const state = {};
  for (const def of PARAM_DEFS) {
    state[def.name] = def.defaultValue;
  }
  return state;
}

/**
 * 检查参数名是否合法
 * @param {string} name
 * @returns {boolean}
 */
export function isValidTunableName(name) {
  return DEF_INDEX.has(name);
}
