// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 环节宪法 — 杂碎本 v3.0
 *
 * 基于 L3 5 份环节宪法（intent-recognition / record / search / organize / other）。
 * 每份宪法包含 changeLevel + changeLevelReason 输出约束。
 * 提供 buildPrompt 工厂函数，将宪法+公共规则+状态快照拼装为 LLM prompt。
 *
 * @module zacuiben/constitution-sessions
 */

import { ROOT_CONSTITUTION } from './root-constitution.js';

// ═══════════════════════════════════════════════════════════
// 公共规则（基于 L3 common-rules.json）
// ═══════════════════════════════════════════════════════════

/** 公共规则 — 所有环节共享 */
export const COMMON_RULES = Object.freeze({
  constitution: 'common-rules',
  version: 'v3.0',
  rules: Object.freeze([
    Object.freeze({
      id: 1,
      name: '输出格式',
      content: '输出必须是纯 JSON。turnType 六值齐全：ask/reply/complete/off-task/giveup/validation_failed。',
    }),
    Object.freeze({
      id: 2,
      name: '角色真实',
      content: '你是杂碎本，极简碎片记录助手。每句话 30 字以内。禁止延伸、建议、"您还可以"、"如果需要"。不替用户做任何分类、标签或智能分析。诚实、不假装懂、不编造功能。',
    }),
    Object.freeze({
      id: 3,
      name: '跨任务延伸检测',
      content: 'field_based 场景，needSemanticExtensionCheck=false。仅检查字段白名单。',
    }),
  ]),
});

// ═══════════════════════════════════════════════════════════
// 份 1：意图识别宪法
// ═══════════════════════════════════════════════════════════

export const intentRecognitionConstitution = Object.freeze({
  intent: 'intent-recognition',
  taskType: 'field_based',
  needSemanticExtensionCheck: false,
  topicEvolutionEnabled: false,
  importance: 'high',
  importanceDeliverable: {
    extracted: 'critical',
    intentConfidence: 'high',
  },

  /** 5 意图 + 3 级阈值 */
  fieldRules: Object.freeze({
    intent: {
      description: '收到用户输入，判断意图：record=录入/search=检索/organize=整理/setting=设置/other=其他',
      thresholds: Object.freeze({
        direct: [80, 100],   // ≥80 直发
        confirm: [60, 80],   // 60-80 反问确认
        guide: [0, 60],      // <60 引导
      }),
      values: Object.freeze(['record', 'search', 'organize', 'setting', 'other']),
    },
    confidence: {
      description: '置信度 0-100',
      range: [0, 100],
    },
    'extracted.key': {
      description: '提取的 Key（可为 null）',
    },
    'extracted.content': {
      description: '提取的 Content（可为 null）',
    },
    'extracted.time': {
      description: '提取的整理时间（可为 null）',
    },
  }),

  /** extracted 结构要求 */
  extractedSchema: Object.freeze({
    key: { type: 'string|null' },
    content: { type: 'string|null' },
    contentValid: { type: 'boolean' },
    time: { type: 'string|null' },
  }),

  validation: Object.freeze({
    required_fields: ['intent', 'confidence', 'extracted'],
    rules: Object.freeze([
      Object.freeze({ field: 'intent', type: 'enum', values: ['record', 'search', 'organize', 'setting', 'other'], error_tag: 'intent_invalid' }),
      Object.freeze({ field: 'confidence', type: 'range', min: 0, max: 100, error_tag: 'confidence_range' }),
      Object.freeze({ field: 'extracted', type: 'custom', function: 'check_extracted_structure', error_tag: 'extracted_malformed' }),
    ]),
  }),

  completionCondition: 'intent ∈ 五值 + confidence ∈ [0,100] + JSON 结构完整',

  /** changeLevel 输出约束 */
  outputSchema: Object.freeze({
    turnType: 'ask | reply | complete | off-task | giveup | validation_failed',
    askingField: 'intent',
    changeLevel: 'major | minor | invalid',
    changeLevelReason: '用于修改日志记录',
  }),
});

// ═══════════════════════════════════════════════════════════
// 份 2：录入宪法
// ═══════════════════════════════════════════════════════════

export const recordConstitution = Object.freeze({
  intent: 'record',
  taskType: 'field_based',
  needSemanticExtensionCheck: false,
  topicEvolutionEnabled: false,
  importance: 'critical',
  importanceDeliverable: {
    currentRecord: 'critical',
    organizeTime: 'high',
  },

  fieldRules: Object.freeze({
    key: {
      method: 'custom',
      function: 'check_key_has_noun',
      description: 'Key 必须至少包含一个名词，且只能由名词/动词/形容词组成。为空时自动生成"临时-{序号}"',
      error_tag: 'key_no_noun',
      allowTempKey: true,
    },
    content: {
      method: 'length',
      max: 5000,
      description: '用户原始文本直接保存。可为空。超过 5000 字提示"内容太长了，请精简到 5000 字以内"',
      error_tag: 'content_too_long',
    },
    attachments: {
      method: 'custom',
      function: 'check_attachment_limits',
      description: '类型：图片/视频/音频/文件（不含可执行文件）。上限 5 个。图片≤10MB，视频≤100MB，音频≤50MB',
      error_tag: 'attachment_limit',
      limits: Object.freeze({
        maxCount: 5,
        imageMaxMb: 10,
        videoMaxMb: 100,
        audioMaxMb: 50,
      }),
    },
    organizeTime: {
      method: 'custom',
      function: 'check_time_or_defaults',
      description: '用户指定时间→解析；"默认"/"随便"/超时 5s→7 天后；"永不"→永不',
      error_tag: 'time_invalid',
    },
  }),

  validation: Object.freeze({
    required_fields: ['currentRecord'],
    rules: Object.freeze([
      Object.freeze({ field: 'currentRecord.key', type: 'custom', function: 'check_key_has_noun', error_tag: 'key_invalid', allowTempKey: true }),
      Object.freeze({ field: 'currentRecord.content', type: 'length', max: 5000, error_tag: 'content_too_long' }),
    ]),
  }),

  completionCondition: 'Key+Content+附件处理+整理时间 全部确定，记录已保存',

  outputSchema: Object.freeze({
    turnType: 'ask | reply | complete | off-task | giveup',
    askingField: 'key | content | attachment | time',
    changeLevel: 'major | minor | invalid',
    changeLevelReason: '用于修改日志记录',
  }),
});

// ═══════════════════════════════════════════════════════════
// 份 3：检索宪法
// ═══════════════════════════════════════════════════════════

export const searchConstitution = Object.freeze({
  intent: 'search',
  taskType: 'field_based',
  needSemanticExtensionCheck: false,
  topicEvolutionEnabled: false,
  importance: 'normal',
  importanceDeliverable: {
    searchResults: 'critical',
  },

  /** Key 精确匹配，不语义搜索 */
  fieldRules: Object.freeze({
    searchKey: {
      method: 'exact_match',
      description: '按 Key 精确匹配，不语义搜索。单条→直返；多条→问具体时间；无匹配→提示',
      error_tag: 'key_not_found',
    },
    timeSpecifier: {
      method: 'custom',
      function: 'check_time_or_defaults',
      description: '用户指定时间→匹配；"不确定"/"都看看"→倒序列出全部；"算了"/超时 10s→取消',
      error_tag: 'time_invalid',
    },
    attachmentView: {
      method: 'custom',
      function: 'open_attachment',
      description: '用户说"打开附件"/"看看图"→打开附件',
      error_tag: 'attachment_open_failed',
    },
  }),

  completionCondition: '搜索结果已展示 或 用户取消',

  outputSchema: Object.freeze({
    turnType: 'reply | complete | off-task | giveup',
    askingField: 'search_key',
    changeLevel: 'minor | invalid',
    changeLevelReason: '用于修改日志记录',
  }),
});

// ═══════════════════════════════════════════════════════════
// 份 4：整理宪法
// ═══════════════════════════════════════════════════════════

export const organizeConstitution = Object.freeze({
  intent: 'organize',
  taskType: 'field_based',
  needSemanticExtensionCheck: false,
  topicEvolutionEnabled: false,
  importance: 'normal',
  importanceDeliverable: {
    organizeActions: 'critical',
  },

  /** skip/discard/done + 临时 Key + skipCount 自动废弃 */
  fieldRules: Object.freeze({
    organizeAction: {
      method: 'enum',
      values: Object.freeze(['name', 'done', 'skip', 'discard', 'exit']),
      description: 'name=临时 Key 起名；done=确认；skip=跳过；discard=废弃；exit=退出',
    },
    newKey: {
      method: 'custom',
      function: 'check_key_has_noun',
      description: '临时 Key 起名时校验格式',
      error_tag: 'key_no_noun',
    },
    skipCount: {
      method: 'range',
      min: 0,
      max: 3,
      description: '临时 Key 记录 skipCount≥3→自动废弃',
      error_tag: 'auto_discard',
    },
  }),

  displayRules: Object.freeze({
    priority: '临时 Key 优先',
    order: '时间倒序',
    format_temp: '未整理（第k/N）。{tempKey}——{content}，{createdAt}。附件：{count}。这条还没有正式名字，要起一个吗？',
    format_formal: '未整理（第k/N）。{key}——{content}，{createdAt}。附件：{count}。好了？',
  }),

  completionCondition: '队列走完 或 用户退出',

  outputSchema: Object.freeze({
    turnType: 'reply | complete | off-task | giveup',
    askingField: 'organize_action',
    changeLevel: 'major | minor | invalid',
    changeLevelReason: '用于修改日志记录',
  }),
});

// ═══════════════════════════════════════════════════════════
// 份 5：其他宪法（兜底引导）
// ═══════════════════════════════════════════════════════════

export const otherConstitution = Object.freeze({
  intent: 'other',
  taskType: 'field_based',
  needSemanticExtensionCheck: false,
  topicEvolutionEnabled: false,
  importance: 'low',
  importanceDeliverable: {
    reply: 'critical',
  },

  fieldRules: Object.freeze({
    reply: {
      method: 'static_template',
      description: '固定引导语：没听明白，请说"杂碎本，记一下"来记录碎片信息，或者说"找XXX"来检索已有记录。',
    },
  }),

  completionCondition: '引导语已输出',

  /** 兜底引导固定模板 */
  fallbackTemplate: '没听明白，请说"杂碎本，记一下"来记录碎片信息，或者说"找XXX"来检索已有记录。',

  outputSchema: Object.freeze({
    turnType: 'reply',
    askingField: null,
    changeLevel: 'invalid',
    changeLevelReason: '非实质性操作',
  }),
});

// ═══════════════════════════════════════════════════════════
// 宪法索引
// ═══════════════════════════════════════════════════════════

/** 按意图获取环节宪法 */
const SESSION_MAP = Object.freeze({
  'intent-recognition': intentRecognitionConstitution,
  record: recordConstitution,
  search: searchConstitution,
  organize: organizeConstitution,
  other: otherConstitution,
});

/**
 * 按意图获取环节宪法
 * @param {string} intent - 意图标识
 * @returns {Object|undefined}
 */
export function getSessionConstitution(intent) {
  return SESSION_MAP[intent];
}

/**
 * 获取所有环节宪法
 * @returns {Array<Object>}
 */
export function getAllSessionConstitutions() {
  return Object.values(SESSION_MAP);
}

// ═══════════════════════════════════════════════════════════
// buildPrompt 工厂
// ═══════════════════════════════════════════════════════════

/**
 * 将一份环节宪法编译为 LLM system prompt 文本块
 *
 * @param {Object} constitution - 环节宪法对象
 * @param {Object} [ctx={}] - 运行时上下文（当前状态快照）
 * @param {Object} [ctx.fields] - 当前已完成字段
 * @param {Array} [ctx.records] - 匹配记录列表
 * @param {Object} [ctx.tunables] - 可调参数当前值
 * @returns {string} 编译后的 prompt 文本
 */
export function buildPrompt(constitution, ctx = {}) {
  if (!constitution) return '';

  const lines = [];

  // 1. 注入根宪法摘要
  lines.push('<!-- @constitution root v3.0 -->');
  for (const article of ROOT_CONSTITUTION.articles) {
    lines.push(`<!-- 第${article.id}条 ${article.name}: ${article.content} -->`);
  }

  // 2. 注入公共规则
  lines.push('');
  lines.push('<!-- @constitution common-rules v3.0 -->');
  for (const rule of COMMON_RULES.rules) {
    lines.push(`<!-- 规则${rule.id} ${rule.name}: ${rule.content} -->`);
  }
  lines.push('你是杂碎本，极简碎片记录助手。每句话30字以内。禁止延伸/建议/智能分析。');

  // 3. 注入环节宪法
  lines.push('');
  lines.push(`<!-- @constitution ${constitution.intent} -->`);
  lines.push(`<!-- @section task-boundary: taskType=${constitution.taskType}, needSemanticExtensionCheck=${constitution.needSemanticExtensionCheck} -->`);

  // 3a. 字段规则
  if (constitution.fieldRules) {
    lines.push('<!-- @section field-rules -->');
    for (const [field, rule] of Object.entries(constitution.fieldRules)) {
      lines.push(`<!-- field:${field} method:${rule.method} desc:${rule.description || ''} -->`);
      if (rule.values) {
        lines.push(`<!--   values: ${rule.values.join(' | ')} -->`);
      }
      if (rule.thresholds) {
        lines.push(`<!--   thresholds: direct[${rule.thresholds.direct[0]},${rule.thresholds.direct[1]}] confirm[${rule.thresholds.confirm[0]},${rule.thresholds.confirm[1]}] guide[${rule.thresholds.guide[0]},${rule.thresholds.guide[1]}] -->`);
      }
    }
  }

  // 3b. 验证规则
  if (constitution.validation) {
    lines.push('<!-- @section validation-guard (deterministic, zero-LLM) -->');
    for (const rule of constitution.validation.rules) {
      lines.push(`<!-- validate: ${rule.field} type:${rule.type}${rule.values ? ' values:' + rule.values.join('|') : ''} error:${rule.error_tag} -->`);
    }
  }

  // 3c. 输出 Schema
  if (constitution.outputSchema) {
    lines.push('<!-- @section output-schema -->');
    const os = constitution.outputSchema;
    lines.push(`<!-- turnType: ${os.turnType} -->`);
    lines.push(`<!-- askingField: ${os.askingField} -->`);
    lines.push(`<!-- changeLevel: ${os.changeLevel} -->`);
    lines.push(`<!-- changeLevelReason: ${os.changeLevelReason || '用于修改日志记录'} -->`);
  }

  // 3d. 完成条件
  if (constitution.completionCondition) {
    lines.push('<!-- @section completion -->');
    lines.push(`<!-- completionCondition: ${constitution.completionCondition} -->`);
  }

  // 4. 运行时上下文（状态快照）
  if (ctx.fields && Object.keys(ctx.fields).length > 0) {
    lines.push('');
    lines.push('<!-- @section runtime-context -->');
    for (const [k, v] of Object.entries(ctx.fields)) {
      if (v != null) {
        lines.push(`<!-- ctx.${k}: ${typeof v === 'object' ? JSON.stringify(v).substring(0, 200) : v} -->`);
      }
    }
  }

  // 5. 可调参数快照（影响 DET 判断）
  if (ctx.tunables && Object.keys(ctx.tunables).length > 0) {
    lines.push('');
    lines.push('<!-- @section tunables-snapshot -->');
    lines.push(`<!-- content_max_length: ${ctx.tunables.content_max_length || 5000} -->`);
    lines.push(`<!-- attachment_max_count: ${ctx.tunables.attachment_max_count || 5} -->`);
    lines.push(`<!-- organize_default_days: ${ctx.tunables.organize_default_days || 7} -->`);
    lines.push(`<!-- organize_skip_auto_discard: ${ctx.tunables.organize_skip_auto_discard || 3} -->`);
  }

  // 6. importances 提示
  if (constitution.importance) {
    lines.push('');
    lines.push(`<!-- @importance: ${constitution.importance} -->`);
    if (constitution.importanceDeliverable) {
      for (const [k, v] of Object.entries(constitution.importanceDeliverable)) {
        lines.push(`<!-- @importance deliverable ${k}: ${v} -->`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * 简化版：仅返回核心指令文本（不含 XML 注释），用于 LLM 调用
 *
 * @param {Object} constitution
 * @param {Object} [ctx={}]
 * @returns {string}
 */
export function buildCompactPrompt(constitution, ctx = {}) {
  if (!constitution) return '';

  const parts = [];

  // 角色 + 核心规则
  parts.push('你是杂碎本，极简碎片记录助手。每句话30字以内。输出纯JSON。');

  // 意图描述
  if (constitution.fieldRules) {
    for (const [field, rule] of Object.entries(constitution.fieldRules)) {
      if (rule.description) {
        parts.push(rule.description);
      }
    }
  }

  // 完成条件
  if (constitution.completionCondition) {
    parts.push(`完成条件：${constitution.completionCondition}`);
  }

  // 输出格式约束
  if (constitution.outputSchema) {
    const os = constitution.outputSchema;
    parts.push(`输出JSON含 turnType(${os.turnType}) + changeLevel(${os.changeLevel}) + changeLevelReason + message(≤30字) + collectedFields.`);
  }

  // 上下文
  if (ctx.fields && ctx.fields.content) {
    parts.push(`当前记录：${ctx.fields.content}`);
  }

  return parts.join('\n');
}
