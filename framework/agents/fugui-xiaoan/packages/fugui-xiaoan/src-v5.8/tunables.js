// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * tunables 参数管理 — 富贵小安 v5.8
 *
 * v5.7 新增: conversation_segmentation_enabled, summary_retention_critical/high/normal
 * v5.8 新增: conversation_archive_enabled
 *
 * @module fugui-xiaoan/tunables-v5.8
 */

// ═══ 完整参数清单(23个适用于富贵小安) ═══

const DEFAULTS = Object.freeze({
  // 通用16
  logprobs_threshold:              0.4,
  turnHistory_limit:               20,
  boundary_coverage_threshold:     0.85,
  contract_inheritance_limit:      0.3,
  pending_fields_ttl:              24 * 3600,
  domain_rule_validation_threshold: 0.7,
  rule_mining_schedule:            '0 2 * * *',
  rule_mining_batch_threshold:     5,
  rule_mining_batch_size:          10,
  cold_start_observation_window:   50,
  cold_start_emergency_threshold:  0.5,
  pid_kp:                          0.1,
  critical_room_history_boost:     2.0,
  strengthens_weight_cap:          3,
  changelevel_major_sample_rate:   0.05,
  max_critical_rooms:              3,

  // field_based 专用2
  amount_limit_max:                999999,
  session_checkpoint_ttl:          604800,

  // v5.7 分段保留4
  conversation_segmentation_enabled: true,
  summary_retention_critical:      10,
  summary_retention_high:          5,
  summary_retention_normal:        2,

  // v5.8 全量备份1
  conversation_archive_enabled:    true,
});

// ═══ 冷启动计数值 ═══
let sessionCount = 0;

export function getTunable(name, fallback) {
  return DEFAULTS[name] ?? fallback;
}

export function getDefaults() {
  return { ...DEFAULTS };
}

export function incrementSession() {
  sessionCount++;
}

export function getSessionCount() {
  return sessionCount;
}

export function isColdStart() {
  return sessionCount < DEFAULTS.cold_start_observation_window;
}

// ═══ PID 控制 ═══════════════════════════
let pidLogprobs = DEFAULTS.logprobs_threshold;

export function pidAdjustLogprobs(actualInterceptRate) {
  if (isColdStart()) return pidLogprobs;
  const target = 0.05;
  const kp = DEFAULTS.pid_kp;
  pidLogprobs += kp * (target - actualInterceptRate);
  pidLogprobs = Math.max(0, Math.min(1, pidLogprobs));
  return pidLogprobs;
}
