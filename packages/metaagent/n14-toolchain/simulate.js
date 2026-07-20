// @MetaAgent v5.8 — n14-toolchain/simulate.js
// 行为测试：驱动元智能体跑 7 个 case
// Mock DeepSeek API，不依赖真实网络

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StateMachine, STATES } from '../src-v5.8/state-machine.js';
import { RouteTable } from '../src-v5.8/route-table.js';
import { createDefaultTunables } from '../src-v5.8/tunables.js';

const L3_PATH = join(import.meta.dirname || '.', '..', '..', '..', 'MetaAgent', 'docs', 'l3-v5.8');

// ═══ 7 个测试 case（来自 L2-N13-N15）══════
export const CASES = [
  {
    id: 1,
    input: '帮我设计一个记账智能体',
    expected: { analyzingIntent: 'P0', stateEndsWith: 'IN_SESSION(P0)' },
    description: 'Case 1: 新设计 → P0认知加载',
  },
  {
    id: 2,
    input: '继续上次那个智能体设计',
    expected: { analyzingIntent: 'other', note: 'topicEvolution匹配需WAITING_CONFIRM' },
    description: 'Case 2: 续写 → topicEvolution',
  },
  {
    id: 3,
    input: '我不确定选field_based还是topic_based',
    expected: { analyzingIntent: 'N1', stateEndsWith: 'IN_SESSION(N1)' },
    description: 'Case 3: taskType判定 → N1帮助',
  },
  {
    id: 4,
    input: '能不能跳过N2直接到N3',
    expected: { turnType: 'guided_reject' },
    description: 'Case 4: 跳过节点 → 引导性硬拒',
  },
  {
    id: 5,
    input: '帮我写一段Python代码',
    expected: { turnType: 'guided_reject' },
    description: 'Case 5: 代码请求 → 引导性硬拒',
  },
  {
    id: 6,
    input: '回到N1重新定义场景',
    expected: { analyzingIntent: 'N1', turnType: 'off-task' },
    description: 'Case 6: 回退 → off-task→ANALYZING',
  },
  {
    id: 7,
    input: '切断房间',
    expected: { m1Match: 'switch', stateSettles: 'ANALYZING' },
    description: 'Case 7: switch口令 → S3切换',
  },
];

// ═══ Mock DeepSeek Adapter ═══
class MockDeepSeekAdapter {
  constructor() {
    this.callHistory = [];
    this._lastInput = '';
  }

  buildAnalyzingPrompt(input) {
    this._lastInput = input;
    return { model: 'deepseek-v3', messages: [{ role: 'system', content: 'mock' }, { role: 'user', content: input }] };
  }

  async _call() {
    return { choices: [{ message: { content: 'A' }, logprobs: { content: [{ logprob: -0.1 }] } }] };
  }

  /** 输入感知的意图映射 */
  parseAnalyzingResult() {
    const input = this._lastInput;
    // 按 L2-N1 doList 顺序: A=P0, B=N1, C=N2, ... Q=other
    const intentMap = {
      '帮我设计': { letter: 'A', probability: 0.90 },   // P0
      '继续上次': { letter: 'C', probability: 0.85 },   // N2 (topicEvolution匹配)
      '不确定':   { letter: 'B', probability: 0.82 },   // N1 (帮助判定)
      '能不能跳过': { letter: 'D', probability: 0.72 },   // N3 (拦在N2之前)
      'Python代码': { letter: 'Q', probability: 0.95 },  // other
      '回到N1':    { letter: 'B', probability: 0.88 },   // N1 (重新定义)
      '切断房间':  { letter: 'Q', probability: 0.99 },   // other (M1处理)
    };
    for (const [key, val] of Object.entries(intentMap)) {
      if (input.includes(key)) return val;
    }
    return { letter: 'A', probability: 0.80 };
  }

  async callInSession(systemPrompt, messages) {
    this.callHistory.push({ systemPrompt: systemPrompt.slice(0, 100), messages });
    return {
      choices: [{
        message: {
          content: 'turnType=complete\n\n好的，我们开始设计。请描述你的智能体要解决什么问题？',
          tool_calls: [],
        },
      }],
    };
  }

  parseInSessionResult(result) {
    const choice = result.choices?.[0];
    return {
      content: choice?.message?.content || '',
      turnType: (choice?.message?.content?.match(/turnType[=:]\s*['"]?(\w+)['"]?/)?.[1]) || 'reply',
      toolCalls: [],
    };
  }
}

// ═══ 运行 simulate ═══
export async function runSimulate() {
  const sm = new StateMachine(L3_PATH);
  const rt = new RouteTable(L3_PATH);
  const adapter = new MockDeepSeekAdapter();
  const tunables = createDefaultTunables();

  const results = [];
  const trace = [];

  for (const c of CASES) {
    const result = { caseId: c.id, description: c.description, input: c.input, pass: true, details: [] };

    // M1 检查
    const m1 = checkM1(c.input);
    if (m1) {
      result.details.push(`M1匹配: ${m1.type}`);
      if (c.expected.m1Match && m1.type === c.expected.m1Match) {
        result.details.push(`✅ M1类型匹配`);
      } else if (c.expected.m1Match) {
        result.pass = false;
        result.details.push(`❌ M1类型不匹配: 期望${c.expected.m1Match} 实际${m1.type}`);
      }
    }

    // ANALYZING
    adapter.buildAnalyzingPrompt(c.input);  // 传入用户输入
    const intentResult = adapter.parseAnalyzingResult();
    const intent = letterToIntent(intentResult.letter);
    result.details.push(`ANALYZING→${c.input.slice(0, 12)} → letter=${intentResult.letter} intent=${intent} prob=${intentResult.probability.toFixed(2)}`);

    // 状态转移
    try {
      const taskType = intent === 'N11' || intent === 'N12' ? 'field_based' : 'topic_based';
      sm.transition(STATES.IN_SESSION, intent, taskType);
      result.details.push(`状态转移→${sm.fullState}`);
    } catch (e) {
      result.pass = false;
      result.details.push(`❌ 状态转移失败: ${e.message}`);
    }

    // 路由匹配
    const route = rt.match(sm.fullState, 'turnType=complete');
    result.details.push(route ? `路由到 ${route.to}` : '⚠️ 无匹配路由');

    // 期望检查
    if (c.expected.stateEndsWith && !sm.fullState.includes(c.expected.stateEndsWith)) {
      result.pass = false;
      result.details.push(`❌ 状态不匹配: 期望${c.expected.stateEndsWith} 实际${sm.fullState}`);
    }

    results.push(result);
    trace.push({ caseId: c.id, state: sm.fullState });
  }

  const passed = results.filter(r => r.pass).length;
  return { passed, failed: results.length - passed, total: results.length, results, trace };
}

/** 字母→intent 映射 */
function letterToIntent(letter) {
  const order = ['P0','N1','N2','N3','N4','N5','N6','N7','N8','N9','N10','N11','N12','N13','N14','N15','other'];
  const idx = letter.charCodeAt(0) - 65;
  return order[idx] || 'other';
}

/** M1 硬匹配 */
function checkM1(input) {
  const t = input.trim();
  if (t === '元智能体') return { type: 'wake' };
  if (t === '退出') return { type: 'exit' };
  if (t === '取消') return { type: 'cancel' };
  if (t === '切断房间') return { type: 'switch' };
  return null;
}

export function formatSimulateReport(result) {
  const lines = [];
  lines.push(`  通过: ${result.passed}/${result.total}`);
  result.results.forEach(r => {
    const icon = r.pass ? '✅' : '❌';
    lines.push(`  ${icon} Case ${r.caseId} "${r.description}"`);
    r.details.forEach(d => lines.push(`     ${d}`));
  });
  return lines.join('\n');
}

export function saveReport(result, path) {
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf-8');
}
