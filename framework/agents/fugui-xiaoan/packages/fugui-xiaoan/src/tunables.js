// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 可调参数管理 — 基于 L3 tunables.json
 *
 * 14 个参数（12 general + 2 field-based），含 cross-param 冲突检测。
 * 所有参数在初始化时校验范围，运行时通过 getTunable() 读取。
 *
 * @module fugui-xiaoan/tunables
 */

// ═══ 参数定义（对齐 L3 tunables.json） ═══════
const PARAM_DEFS = Object.freeze({
  // ── General Parameters (12) ──
  confidence_threshold: {
    defaultValue: 0.4,
    valueRange: [0.0, 1.0],
    purpose: "Threshold for 'pretend to know' detection",
    consumer: 'DET recheck',
  },
  turnHistory_limit: {
    defaultValue: 20,
    valueRange: [5, 100],
    purpose: 'Base turn retention count for roomConversationLog',
    consumer: 'session-store',
  },
  critical_room_history_boost: {
    defaultValue: 2.0,
    valueRange: [1.0, 5.0],
    purpose: 'Multiplier for critical room turn retention',
    consumer: 'session-store',
    version: 'v4.7',
  },
  pending_fields_ttl: {
    defaultValue: 86400,
    valueRange: [3600, 604800],
    purpose: 'Half-finished record retention duration (seconds)',
    consumer: 'session-store',
  },
  boundary_coverage_threshold: {
    defaultValue: 0.85,
    valueRange: [0.50, 1.00],
    purpose: 'Boundary coverage completeness threshold',
    consumer: 'design-phase validation',
  },
  contract_inheritance_limit: {
    defaultValue: 0.3,
    valueRange: [0.1, 0.5],
    purpose: 'Cross-node contract inheritance injection cap',
    consumer: 'dispatcher',
  },
  cold_start_observation_window: {
    defaultValue: 50,
    valueRange: [20, 200],
    purpose: 'Cold start observation window session count',
    consumer: 'cold start monitor',
  },
  cold_start_emergency_threshold: {
    defaultValue: 0.5,
    valueRange: [0.3, 0.8],
    purpose: 'Emergency thaw trigger threshold',
    consumer: 'cold start monitor',
  },
  pid_kp: {
    defaultValue: 0.1,
    valueRange: [0.01, 1.0],
    purpose: 'P feedback control coefficient',
    consumer: 'auto-tuning engine',
  },
  strengthens_weight_cap: {
    defaultValue: 3,
    valueRange: [1, 10],
    purpose: 'Cap for strengthens edge weight accumulation',
    consumer: 'context-manager',
    version: 'v4.7',
  },
  changelevel_major_sample_rate: {
    defaultValue: 0.05,
    valueRange: [0.01, 0.20],
    purpose: 'Sampling rate for changeLevel major audit',
    consumer: 'audit engine',
    version: 'v4.7',
  },
  max_critical_rooms: {
    defaultValue: 3,
    valueRange: [1, 10],
    purpose: 'Max concurrent critical rooms for cross_param budget check',
    consumer: 'context-manager',
    version: 'v4.7',
  },

  // ── Field-Based Parameters (2) ──
  amount_limit_max: {
    defaultValue: 999999,
    valueRange: [0, 999999999],
    purpose: 'Max amount for value check',
    consumer: 'DET recheck',
  },
  session_checkpoint_ttl: {
    defaultValue: 604800,
    valueRange: [86400, 2592000],
    purpose: 'Session checkpoint expiry in seconds (default 7 days)',
    consumer: 'dispatcher',
    version: 'v4.7',
  },
});

// ═══ 冲突规则 ═══════════════════════════
const CONFLICT_RULES = Object.freeze({
  defaultViolationAction: {
    single_param: 'hard_reject',
    cross_param: 'warning',
  },
  single_param: [
    {
      name: 'confidence_threshold_range_check',
      check: (params) => {
        const v = params.confidence_threshold;
        return v >= 0 && v <= 1;
      },
    },
  ],
  cross_param: [
    {
      name: 'critical_room_context_budget_check',
      violation_action: 'warning',
      params: ['turnHistory_limit', 'critical_room_history_boost', 'max_critical_rooms'],
      compute: (params) => {
        const { turnHistory_limit, critical_room_history_boost, max_critical_rooms } = params;
        return max_critical_rooms * turnHistory_limit * critical_room_history_boost * 200 > 128000 * 0.6;
      },
    },
  ],
});

// ═══ 内部状态 ═══════════════════════════
/** @type {Map<string, number|string>} */
let _overrides = new Map();

// ═══ 公开 API ═══════════════════════════

/**
 * 获取可调参数的当前值。
 * 优先返回运行时覆盖值，否则返回默认值。
 *
 * @param {string} name - 参数名称
 * @returns {number|string} 参数当前值
 * @throws {Error} 未知参数名
 */
export function getTunable(name) {
  if (_overrides.has(name)) {
    return _overrides.get(name);
  }
  const def = PARAM_DEFS[name];
  if (!def) {
    throw new Error(`Unknown tunable: "${name}"`);
  }
  return def.defaultValue;
}

/**
 * 设置运行时覆盖值。
 * 校验参数范围，范围外抛错。
 *
 * @param {string} name - 参数名称
 * @param {number|string} value - 新值
 * @throws {Error} 参数未知或值越界
 */
export function setTunable(name, value) {
  const def = PARAM_DEFS[name];
  if (!def) {
    throw new Error(`Unknown tunable: "${name}"`);
  }

  const [min, max] = def.valueRange;
  if (typeof value !== 'number' || value < min || value > max) {
    throw new Error(`Tunable "${name}" = ${value} out of range [${min}, ${max}]`);
  }

  _overrides.set(name, value);
}

/**
 * 重置所有覆盖值为默认值。
 */
export function resetTunables() {
  _overrides.clear();
}

/**
 * 获取所有参数定义（只读）。
 * @returns {object}
 */
export function getTunableDefs() {
  return PARAM_DEFS;
}

/**
 * 运行冲突检测。
 * 检查 single_param 和 cross_param 规则。
 *
 * @param {object} [params] - 要检查的参数集（默认合并 defaults + overrides）
 * @returns {{ conflicts: Array<{rule: string, violation: string, action: string}> }}
 */
export function detectConflicts(params) {
  const effective = {};
  for (const name of Object.keys(PARAM_DEFS)) {
    effective[name] = _overrides.has(name) ? _overrides.get(name) : PARAM_DEFS[name].defaultValue;
  }
  // 合并传入的 params
  if (params) Object.assign(effective, params);

  const conflicts = [];

  // 单参数检查
  for (const rule of CONFLICT_RULES.single_param) {
    if (!rule.check(effective)) {
      conflicts.push({
        rule: rule.name,
        violation: `Parameter check failed: ${rule.name}`,
        action: CONFLICT_RULES.defaultViolationAction.single_param,
      });
    }
  }

  // 跨参数检查
  for (const rule of CONFLICT_RULES.cross_param) {
    if (rule.compute(effective)) {
      conflicts.push({
        rule: rule.name,
        violation: `Cross-param budget exceeded: ${rule.params.join(', ')}`,
        action: rule.violation_action || CONFLICT_RULES.defaultViolationAction.cross_param,
      });
    }
  }

  return { conflicts };
}

/**
 * 获取所有可调参数的当前有效值快照（用于序列化/schedulerState）。
 * @returns {object}
 */
export function getTunableSnapshot() {
  const snapshot = {};
  for (const name of Object.keys(PARAM_DEFS)) {
    snapshot[name] = getTunable(name);
  }
  return snapshot;
}

/**
 * 导出参数定义（供 root-constitution 引用）。
 */
export { PARAM_DEFS as TUNABLES };

export default {
  getTunable,
  setTunable,
  resetTunables,
  getTunableDefs,
  getTunableSnapshot,
  detectConflicts,
  TUNABLES: PARAM_DEFS,
};
