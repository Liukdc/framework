// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * tunable 冲突检测引擎 — 富贵小安 v5.8
 *
 * 支持两种规则类型:
 *   single_param: range/enum 硬校验,违规硬拒绝
 *   cross_param: 跨参数语义校验,违规默认 warning
 *
 * @module fugui-xiaoan/conflict-detector-v5.8
 */

import { getTunable, getDefaults } from './tunables.js';

// ═══ single_param 规则 ═══════════════════════
const SINGLE_PARAM_RULES = [
  { name:'logprobs_threshold_range', param:'logprobs_threshold', check:(v) => v>=0 && v<=1, msg:'logprobs_threshold 必须在 [0,1]' },
  { name:'turnHistory_limit_range', param:'turnHistory_limit', check:(v) => v>=5 && v<=100, msg:'turnHistory_limit 必须在 [5,100]' },
  { name:'amount_limit_max_range', param:'amount_limit_max', check:(v) => v>=0, msg:'amount_limit_max 必须 >= 0' },
  { name:'session_checkpoint_ttl_range', param:'session_checkpoint_ttl', check:(v) => v>=86400 && v<=2592000, msg:'session_checkpoint_ttl 必须在 [1天,30天]' },
  { name:'cold_start_window_range', param:'cold_start_observation_window', check:(v) => v>=20 && v<=200, msg:'cold_start_observation_window 必须在 [20,200]' },
  { name:'conversation_segmentation_type', param:'conversation_segmentation_enabled', check:(v) => typeof v === 'boolean', msg:'conversation_segmentation_enabled 必须是 boolean' },
  { name:'summary_critical_range', param:'summary_retention_critical', check:(v) => v>=3 && v<=50, msg:'summary_retention_critical 必须在 [3,50]' },
  { name:'summary_high_range', param:'summary_retention_high', check:(v) => v>=2 && v<=20, msg:'summary_retention_high 必须在 [2,20]' },
  { name:'summary_normal_range', param:'summary_retention_normal', check:(v) => v>=1 && v<=10, msg:'summary_retention_normal 必须在 [1,10]' },
  { name:'conversation_archive_type', param:'conversation_archive_enabled', check:(v) => typeof v === 'boolean', msg:'conversation_archive_enabled 必须是 boolean' },
];

// ═══ cross_param 规则 ═══════════════════════
const CROSS_PARAM_RULES = [
  {
    name: 'critical_room_budget_check',
    params: ['turnHistory_limit', 'critical_room_history_boost', 'max_critical_rooms'],
    check: (vals) => {
      const { turnHistory_limit, critical_room_history_boost, max_critical_rooms } = vals;
      const est = max_critical_rooms * turnHistory_limit * critical_room_history_boost * 200;
      return { valid: est <= 128000 * 0.6, message: 'critical房间上下文预算可能超限', suggestion: `建议turnHistory_limit降至 ${Math.floor(128000*0.6/max_critical_rooms/critical_room_history_boost/200)}` };
    },
    action: 'warning',
  },
  {
    name: 'cold_start_vs_logprobs',
    params: ['cold_start_observation_window', 'logprobs_threshold'],
    check: (vals) => {
      const ok = vals.cold_start_observation_window <= 150;
      return { valid: ok, message: '冷启动窗口>150时logprobs_threshold长期冻结', suggestion: '建议window控制在50-100' };
    },
    action: 'warning',
  },
];

// ═══ 主检测函数 ═══════════════════════════

/**
 * 运行完整的冲突检测
 * @param {Object} overrides - 待检测的参数覆盖值 (只包含有变化的参数)
 * @returns {{ valid: boolean, errors: Array, warnings: Array }}
 */
export function runConflictCheck(overrides = {}) {
  const defaults = getDefaults();
  const values = { ...defaults, ...overrides };
  const errors = [];
  const warnings = [];

  // single_param: 硬拒绝
  for (const rule of SINGLE_PARAM_RULES) {
    const value = values[rule.param];
    if (value !== undefined && !rule.check(value)) {
      errors.push({ rule: rule.name, param: rule.param, value, message: rule.msg, action: 'hard_reject' });
    }
  }

  // cross_param: 警告
  for (const rule of CROSS_PARAM_RULES) {
    const paramVals = {};
    let allPresent = true;
    for (const p of rule.params) {
      if (values[p] === undefined) { allPresent = false; break; }
      paramVals[p] = values[p];
    }
    if (allPresent) {
      const result = rule.check(paramVals);
      if (!result.valid) {
        warnings.push({ rule: rule.name, message: result.message, suggestion: result.suggestion, action: rule.action });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 保存前校验——hard_reject 拒绝保存，warning 弹窗但允许继续
 * @param {Object} overrides
 * @returns {{ canSave: boolean, errors: Array, warnings: Array }}
 */
export function validateBeforeSave(overrides) {
  const result = runConflictCheck(overrides);
  return {
    canSave: result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    saveAdvice: result.errors.length > 0 ? '以下参数违规,请修正后重试' : (result.warnings.length > 0 ? '存在警告,是否仍然保存?' : '可以保存'),
  };
}

export function formatConflictReport(result) {
  const lines = [];
  if (result.errors.length) {
    lines.push(`❌ ${result.errors.length} 个硬拒绝:`);
    result.errors.forEach(e => lines.push(`  ${e.param}: ${e.message} (当前值: ${e.value})`));
  }
  if (result.warnings.length) {
    lines.push(`⚠️ ${result.warnings.length} 个警告:`);
    result.warnings.forEach(w => lines.push(`  ${w.rule}: ${w.message} → ${w.suggestion}`));
  }
  if (!result.errors.length && !result.warnings.length) lines.push('✅ 无冲突');
  return lines.join('\n');
}
