// @MetaAgent v5.8 — scheduler 集成测试
// node --test src-v5.8/scheduler.test.js
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Scheduler } from './scheduler.js';
import { StateMachine, STATES } from './state-machine.js';

// ═══ helpers ═══
function mockAdapter(responses = {}) {
  const defaults = {
    analyzing: { letter: 'A', probability: 0.85 },
    inSession: { turnType: 'ask', content: 'mock reply', toolCalls: [] },
  };
  const merged = { ...defaults, ...responses };

  return {
    buildAnalyzingPrompt: () => ({ messages: [], system: '', max_tokens: 100 }),
    parseAnalyzingResult: () => ({ letter: merged.analyzing.letter, probability: merged.analyzing.probability }),
    callInSession: async () => JSON.stringify(merged.inSession),
    callCodeModel: async () => JSON.stringify(merged.inSession),
    parseInSessionResult: (raw) => {
      try { return JSON.parse(raw); } catch { return merged.inSession; }
    },
    _call: async () => ({}),
  };
}

function mockStore() {
  return {
    createSession: async () => {},
    updateSessionState: async () => {},
    appendConversation: async () => {},
    appendSegmentBoundary: async () => {},
    appendTopicEvent: async () => {},
    writeOutput: async () => {},
  };
}

function mockContextManager() {
  return {
    buildContext: async () => ['[宪法] 测试环节', '[规则] 无'],
    _loadConstitution: () => '[N2环节宪法]',
  };
}

function mockToolRegistry() {
  return {
    getToolDefinitions: () => [],
    execute: async () => ({}),
  };
}

function mockRouteTable(overrides = {}) {
  return {
    getSecondLayerOverride: () => null,
    match: (state, key) => overrides.match || null,
  };
}

function mockOutputs() {
  return {
    isCritical: () => false,
    outputName: () => 'test-output',
  };
}

function mockTelemetry() {
  return {
    inc: () => {},
    startTrace: () => 'trace-1',
    endTrace: () => {},
    logEvent: () => {},
    recordIntent: () => {},
    recordTransition: () => {},
  };
}

function mockTunables() {
  return { logprobsThreshold: 0.4 };
}

function createScheduler(adapterOverrides, routeOverrides) {
  const sm = new StateMachine('D:/WORKBUDDY/2026-06-21-12-50-52/packages/metaagent/l3-v5.8');
  return new Scheduler(
    sm,
    mockRouteTable(routeOverrides),
    mockAdapter(adapterOverrides),
    mockContextManager(),
    mockToolRegistry(),
    mockStore(),
    mockOutputs(),
    mockTelemetry(),
    mockTunables(),
    'D:/WORKBUDDY/2026-06-21-12-50-52/packages/metaagent/l3-v5.8'
  );
}

// ═══ 测试一：M1 元指令 ═══
describe('M1 元指令 — DET EXACT_MATCH', () => {
  let sched;

  beforeEach(async () => {
    sched = createScheduler();
    await sched.initSession('test-m1');
  });

  it('切断房间 → ANALYZING', async () => {
    const result = await sched.handleTurn('切断房间');
    assert.equal(result.state, STATES.ANALYZING);
    assert.equal(result.turnType, 'reply');
  });

  it('退出 → CLOSING', async () => {
    const result = await sched.handleTurn('退出');
    assert.equal(result.state, STATES.CLOSING);
  });

  it('取消 → LISTENING', async () => {
    const result = await sched.handleTurn('取消');
    assert.equal(result.state, STATES.LISTENING);
  });

  it('元智能体 → LISTENING', async () => {
    const result = await sched.handleTurn('元智能体');
    assert.equal(result.state, STATES.LISTENING);
  });

  it('非精确匹配不触发 M1', async () => {
    const sched2 = createScheduler({ analyzing: { letter: 'A', probability: 0.85 } });
    await sched2.initSession('test-m1-nonmatch');
    const result = await sched2.handleTurn('帮我退出');
    // 不是精确"退出"→ 走 ANALYZING 而不是 CLOSING
    assert.notEqual(result.state, STATES.CLOSING);
  });
});

// ═══ 测试二：核心主循环 ANALYZING→IN_SESSION→complete→DET ═══
describe('核心主循环', () => {
  it('ANALYZING 高置信度 → IN_SESSION', async () => {
    const sched = createScheduler({ analyzing: { letter: 'A', probability: 0.9 } });
    await sched.initSession('test-core');
    const result = await sched.handleTurn('我要设计记账智能体');
    assert.equal(result.turnType, 'ask');
    assert.ok(result.content);
  });

  it('ANALYZING 低置信度 → IN_SESSION(other)', async () => {
    const sched = createScheduler({ analyzing: { letter: 'A', probability: 0.1 } });
    await sched.initSession('test-lowconf');
    const result = await sched.handleTurn('xxx 无意义输入');
    assert.equal(result.turnType, 'ask');
  });

  it('complete → DET 校验通过 → route 触发', async () => {
    const sched = createScheduler(
      { analyzing: { letter: 'A', probability: 0.85 }, inSession: { turnType: 'complete', content: 'done', toolCalls: [] } },
      { match: true }
    );
    await sched.initSession('test-complete');
    const result = await sched.handleTurn('完成设计');
    assert.equal(result.turnType, 'complete');
  });

  it('IN_SESSION 内容为空 → DET 校验失败 → CLARIFYING', async () => {
    const sched = createScheduler(
      { analyzing: { letter: 'B', probability: 0.85 }, inSession: { turnType: 'complete', content: '', toolCalls: [] } },
    );
    // B 对应 topic_based intent (N1)
    await sched.initSession('test-empty');
    const result = await sched.handleTurn(' ');
    assert.equal(result.turnType, 'validation_failed');
  });
});

// ═══ 测试三：off-task 和 giveup ═══
describe('off-task / giveup 路由', () => {
  it('off-task → ANALYZING 重新识别', async () => {
    const sched = createScheduler(
      { analyzing: { letter: 'A', probability: 0.85 }, inSession: { turnType: 'off-task', content: '偏离了', toolCalls: [] } },
      { match: true, topicEvolutionEventAppended: true }
    );
    await sched.initSession('test-offtask');
    const result = await sched.handleTurn('帮我写首诗');
    assert.equal(result.turnType, 'off-task');
  });

  it('giveup → LISTENING', async () => {
    const sched = createScheduler(
      { analyzing: { letter: 'A', probability: 0.85 }, inSession: { turnType: 'giveup', content: '放弃了', toolCalls: [] } },
      { match: true, topicEvolutionEventAppended: true }
    );
    await sched.initSession('test-giveup');
    const result = await sched.handleTurn('不做了');
    assert.equal(result.turnType, 'giveup');
  });
});
