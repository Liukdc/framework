// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 根宪法 + 架构机制 — 富贵小安 v5.8
 *
 * v5.0: 根宪法 8→4 条, 公共规则取消, 架构机制 M1-M4
 *
 * @module fugui-xiaoan/root-constitution-v5.8
 */

// ═══ 根宪法 4 条(不可逾越,不可覆盖) ═══

export const ROOT_CONSTITUTION = Object.freeze([
  {
    id: 1, name: '环节隔离',
    text: '只能做本环节任务，非本环节任务返回 off-task。ANALYZING 只做意图识别。IN_SESSION 只做本环节任务。',
    overridable: false,
  },
  {
    id: 2, name: '输出格式',
    text: '模型返回调度器的结果必须是符合 turnType schema 的结构化 JSON。',
    overridable: false,
  },
  {
    id: 3, name: '收敛义务 + 坚持真实判断',
    text: '所有 LLM 节点必须在当前环节内收敛，不伪造数据、不假装理解、不迎合用户、不无中生有。',
    overridable: false,
  },
  {
    id: 4, name: '不编造功能',
    text: '不得声称具有实际不具备的能力，不得编造系统反馈或虚构操作结果。',
    overridable: false,
  },
]);

// ═══ ANALYZING 特化 ═══════════════════════

export const ANALYZING_SPEC = Object.freeze({
  task: '意图映射: 强制选择 A/B/C/D/E + API logprobs + 第二分类维度 S/T/U',
  output: '{ choice, logprobs, intent, inputNature, extracted }',
  notAllowed: ['采集字段(IN_SESSION的事)', '追问(IN_SESSION的事)', '给出最终回复'],
  fallback: '无法映射到已知 intent → intent=other(低 probability 来自 logprobs)',
});

// ═══ 架构机制 M1-M4 ═══════════════════════

export const ARCHITECTURE_MECHANISMS = Object.freeze({
  M1: {
    name: '元指令集',
    commands: ['wake(唤醒)', 'switch(切断房间)', 'exit(退出)', 'cancel(取消)'],
    matchMode: 'DET EXACT_MATCH(0次LLM)',
    switchBehavior: {
      description: 'S3物理隔离四步',
      steps: [
        '释放当前房间KV Cache(abort_request)',
        '归档当前房间(sessionCheckpoint+roomConversationLog)',
        '加载目标房间checkpoint',
        '创建新推理会话',
      ],
      roomStateIndex: 'buildRoomIndex() 全窗口房间摘要注入 ANALYZING',
    },
    cancelBehavior: '中断当前推理不归档(区别于exit的归档回IDLE)',
  },

  M2: {
    name: '降级链四项检查',
    reducible: false,
    checks: [
      { name: 'L1结构校验', executor: 'DET', trigger: 'complete', failure: '重试1次→熔断→硬编码回复' },
      { name: 'DET值域复验', executor: 'DET', trigger: 'complete', failure: 'CLARIFYING', fieldBased: '值域校验(金额/时间/必填)', topicBased: '输出格式校验' },
      { name: 'logprobs检查', executor: 'DET', trigger: 'complete', failure: 'CLARIFYING', coldStart: '软拦截(标记warning不直接拦截)', nonColdStart: '硬拦截' },
      { name: '硬编码兜底', executor: 'DET', trigger: '熔断', failure: 'LISTENING' },
    ],
  },

  M3: {
    name: '仲裁权DET优先',
    rule: 'det_overrides_model',
    description: '调度器DET校验结果优先于模型内部校验结果，两者冲突时以DET为准',
  },

  M4: {
    name: '节点转换守卫',
    rule: '偏离标记辅助 + 最终判断由模型给出',
    description: 'IN_SESSION期间用户输入偏离时，调度器DET关键词扫描可辅助触发偏离标记，但最终判断由模型给出',
  },
});

// ═══ 元指令口令词表 ═══════════════════════

export const META_COMMANDS = Object.freeze({
  wake: { patterns: ['大猩猩慢慢醒'], action: 'IDLE→LISTENING', s3: '创建新推理会话' },
  exit: { patterns: ['大猩猩飞走吧'], action: '任意→CLOSING→IDLE', s3: '释放KV Cache+归档' },
  cancel: { patterns: ['取消'], action: '任意→LISTENING', s3: '释放当前轮KV(不归档)' },
  switch: { patterns: ['切断房间'], action: '任意→ANALYZING', s3: '四步(释放+归档+加载+新会话)+roomStateIndex' },
});

// ═══ 编程规则宪法(约束代码模型,非运行时模型) ═══

export const PROGRAMMING_RULES = Object.freeze([
  '执行体分派铁律: ANALYZING/IN_SESSION=LLM, EXECUTING=DET(仅写入/删除)',
  'DET职责: EXACT_MATCH+值域复验+关键词扫描+logprobs裁决+SQL查询',
  'LLM职责: 意图识别+字段采集+偏离判断+工具调用决策+结果格式化',
  '降级: 无apiKey时拒绝服务,不降级为正则',
  '契约: 严格对齐N11契约schema',
  '接口: 阈值从getTunable()读,调度器只调三接口',
  'v5.5工具分层: 必用+清单+选用+search_tools,LLM不直接写SQL',
]);

// ═══ 降级链四项检查入口 ═══════════════════

export const DEGRADATION_CHAIN = Object.freeze({
  L1: (result) => result && typeof result === 'object',
  DET_VALUE: (result, intent) => {
    if (intent !== 'record') return { pass: true };
    const a = result?.amount ?? result?.result?.amount;
    if (a !== undefined && (Number(a) <= 0 || Number(a) > 999999)) return { pass: false, reason: '金额异常' };
    return { pass: true };
  },
  LOGPROBS: (result, sessionIdx, coldStartWindow) => {
    const prob = result?._probability ?? 1;
    if (prob >= 0.4) return { pass: true };
    if (sessionIdx < coldStartWindow) {
      result._logprobWarning = `[提示: 模型对此结果概率较低(${prob.toFixed(2)})，请审查]`;
      return { pass: true, softIntercept: true };
    }
    return { pass: false, reason: 'logprobs过低,疑似硬撑式确认' };
  },
  HARDCODED: () => ({ pass: false, reason: '系统暂时无法处理,请稍后重试' }),
});
