// @MetaAgent v5.8 — tunables.js
// 25 个受控调参，含 range/enum 硬限制 + 跨参数联动约束

export const TUNABLE_META = {
  // === General (16) ===
  analyzingModel:        { type: 'enum',   values: ['deepseek-v4-pro', 'deepseek-v4-flash'], default: 'deepseek-v4-pro' },
  inSessionModel:        { type: 'enum',   values: ['deepseek-v4-pro', 'deepseek-v4-flash'], default: 'deepseek-v4-pro' },
  codeModel:             { type: 'enum',   values: ['deepseek-v4-pro'],                    default: 'deepseek-v4-pro' },
  maxContextTokens:      { type: 'range',  min: 4096, max: 128000, default: 64000 },
  maxTurnsPerSession:    { type: 'range',  min: 5,    max: 200,    default: 50 },
  logprobsThreshold:     { type: 'range',  min: 0.3,  max: 0.95,   default: 0.6 },   // ANALYZING 放行阈值
  temperatureAnalyzing:  { type: 'range',  min: 0.0,  max: 0.5,    default: 0.1 },
  temperatureInSession:  { type: 'range',  min: 0.3,  max: 1.0,    default: 0.7 },
  temperatureCode:       { type: 'range',  min: 0.0,  max: 0.3,    default: 0.1 },
  segmentSize:           { type: 'range',  min: 1024, max: 32768,  default: 8192 },  // v5.7 分段大小(char)
  archiveEnabled:        { type: 'enum',   values: [true, false],  default: true },   // v5.8 conversationArchive
  s3ReleaseMode:         { type: 'enum',   values: ['immediate', 'lazy'],             default: 'immediate' }, // S3 KV Cache 释放
  maxTopicEvolutionSize: { type: 'range',  min: 10,   max: 1000,   default: 200 },
  retryOnFail:           { type: 'range',  min: 0,    max: 3,      default: 1 },
  debugMode:             { type: 'enum',   values: [true, false],  default: false },
  strictValidation:      { type: 'enum',   values: [true, false],  default: true },
  relevanceThreshold:    { type: 'range',  min: 0,    max: 100,    default: 20 },    // v5.9 relevance 评分路由阈值

  // === Topic-based specific (4) ===
  topicConfirmRequired:  { type: 'enum',   values: [true, false],  default: true },   // 是否需要 WAITING_CONFIRM
  topicEvolutionCheckpointOnComplete:  { type: 'enum', values: [true, false], default: true },
  topicEvolutionActiveOnOffTask:       { type: 'enum', values: [true, false], default: true },
  threeLayerInjectionDepth: { type: 'enum', values: ['full', 'summary', 'none'], default: 'full' }, // 三层注入深度

  // === v5.7/v5.8 相关 (5) ===
  contractStoreWal:      { type: 'enum',   values: [true, false],  default: true },   // SQLite WAL
  fts5Enabled:           { type: 'enum',   values: [true, false],  default: true },   // FTS5 全文搜索
  segmentationOnConfirm: { type: 'enum',   values: [true, false],  default: true },   // 产出物确认节点分段
  summaryTierLevel:      { type: 'enum',   values: ['brief', 'detail'],               default: 'detail' },
  archiveRetentionDays:  { type: 'range',  min: 1,    max: 365,    default: 90 },
};

// 跨参数联动约束
export const CROSS_PARAM_CONSTRAINTS = [
  {
    // debugMode=true 时 strictValidation 必须为 true
    condition: (params) => params.debugMode === true,
    enforce:   (params) => { params.strictValidation = true; },
    message:   'debugMode=true 强制 strictValidation=true',
  },
  {
    // archiveEnabled=false 时 fts5Enabled 必须为 false
    condition: (params) => params.archiveEnabled === false,
    enforce:   (params) => { params.fts5Enabled = false; },
    message:   'archiveEnabled=false 强制 fts5Enabled=false',
  },
];

export function createDefaultTunables() {
  const params = {};
  for (const [key, meta] of Object.entries(TUNABLE_META)) {
    params[key] = meta.default;
  }
  return params;
}

/** 校验并修正参数，返回 { valid, conflicts, params } */
export function validateTunables(params) {
  const conflicts = [];
  for (const [key, meta] of Object.entries(TUNABLE_META)) {
    if (params[key] === undefined) continue;
    if (meta.type === 'range') {
      if (params[key] < meta.min || params[key] > meta.max) {
        conflicts.push(`${key}=${params[key]} 超出 [${meta.min},${meta.max}]，重置为 ${meta.default}`);
        params[key] = meta.default;
      }
    } else if (meta.type === 'enum') {
      if (!meta.values.includes(params[key])) {
        conflicts.push(`${key}=${params[key]} 不在 ${JSON.stringify(meta.values)} 中，重置为 ${meta.default}`);
        params[key] = meta.default;
      }
    }
  }
  // 跨参数联动
  for (const constraint of CROSS_PARAM_CONSTRAINTS) {
    if (constraint.condition(params)) {
      const before = { ...params };
      constraint.enforce(params);
      conflicts.push(constraint.message);
    }
  }
  return { valid: conflicts.length === 0, conflicts, params };
}

/** 安全读取参数（带默认值兜底） */
export function getTunable(params, key) {
  const meta = TUNABLE_META[key];
  if (!meta) throw new Error(`未知参数: ${key}`);
  return params[key] ?? meta.default;
}
