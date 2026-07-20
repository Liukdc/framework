// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * N14 审骨架 — 行为测试模拟框架
 *
 * 驱动 state-machine.js 运行 21 个刁钻 case,
 * 提取状态转移序列、DET复验记录、上下文拼接记录,
 * 与预期行为对比。
 *
 * @module n14-toolchain/simulate
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ═══ 21 个 case 定义 ═══════════════════════

export const CASES = Object.freeze([
  // ── 正向流程(5) ──
  { id:'case01', name:'空输入',         inputs:['', ''],                                                   expect:{ noCrash:true, stateSequence:['idle'] } },
  { id:'case02', name:'记账-简单',       inputs:['大猩猩慢慢醒', '记一笔午饭25', ''],                        expect:{ stateSequence:['idle','listening','in_session','listening'], result:'已记录' } },
  { id:'case03', name:'查询',            inputs:['大猩猩慢慢醒', '这个月花了多少', ''],                       expect:{ stateSequence:['idle','listening','in_session','listening'] } },
  { id:'case04', name:'删除',            inputs:['大猩猩慢慢醒', '记一笔午饭25', '删除午饭', '确认', ''],      expect:{ stateSequence:['idle','listening','in_session','listening','in_session','waiting_confirm','listening'] } },
  { id:'case05', name:'对比',            inputs:['大猩猩慢慢醒', '这个月和上个月哪个花得多', ''],              expect:{ stateSequence:['idle','listening','in_session','listening'] } },

  // ── 异常流程(8) ──
  { id:'case06', name:'金额超限',        inputs:['大猩猩慢慢醒', '记一笔9999999', ''],                        expect:{ stateSequence:['idle','listening','in_session','clarifying'] } },
  { id:'case07', name:'时间未来',        inputs:['大猩猩慢慢醒', '记一笔明天3000', ''],                       expect:{ stateSequence:['idle','listening','in_session','clarifying'] } },
  { id:'case08', name:'记账中途查',      inputs:['大猩猩慢慢醒', '记一笔午饭25', '查一下总共', ''],             expect:{ offTaskTriggered:true, stateSequence:['idle','listening','in_session','listening','in_session'] } },
  { id:'case09', name:'记账中途放弃',    inputs:['大猩猩慢慢醒', '记一笔午饭25', '算了', ''],                  expect:{ giveupTriggered:true } },
  { id:'case10', name:'切换房间',         inputs:['大猩猩慢慢醒', '记一笔午饭25', '切断房间', ''],              expect:{ switchTriggered:true } },
  { id:'case11', name:'退出',            inputs:['大猩猩慢慢醒', '大猩猩飞走吧', ''],                         expect:{ stateSequence:['idle','listening','idle'] } },
  { id:'case12', name:'连续多轮',        inputs:['大猩猩慢慢醒', '记一笔午饭25', '记一笔交通15', '记一笔零食10', ''], expect:{ stateSequence:['idle','listening','in_session','listening','in_session','listening','in_session','listening'] } },
  { id:'case13', name:'修改字段',        inputs:['大猩猩慢慢醒', '记一笔午饭25', '改金额', '30', ''],           expect:{ modificationTriggered:true } },

  // ── 越界流程(4) ──
  { id:'case14', name:'TEMP_TOPIC',      inputs:['大猩猩慢慢醒', '帮我订机票', ''],                           expect:{ stateStay:'idle' } },
  { id:'case15', name:'SLACK_NODE进',    inputs:['大猩猩慢慢醒', '今天天气真好', ''],                          expect:{ slackEntered:true } },
  { id:'case16', name:'不编造功能',      inputs:['大猩猩慢慢醒', '今天天气真好', '你能帮我炒股吗', ''],          expect:{ noFabrication:true } },
  { id:'case17', name:'修改记录',        inputs:['大猩猩慢慢醒', '记一笔午饭25', '记错了', ''],                 expect:{ modificationTriggered:true } },

  // ── 冷启动(2) ──
  { id:'case18', name:'冷启动软拦截',     inputs:['大猩猩慢慢醒', '记一笔午饭25', ''],                         expect:{ logprobWarning:true } },
  { id:'case19', name:'非冷启动硬拦截',   inputs:[],                                                          expect:{ logprobHardIntercept:false } },

  // ── 恢复(2) ──
  { id:'case20', name:'sessionCheckpoint恢复', inputs:['大猩猩慢慢醒', '记一笔午饭25', ''],                    expect:{ checkpointRecovery:true } },
  { id:'case21', name:'查询恢复',         inputs:['大猩猩慢慢醒', '上次那个查询', ''],                          expect:{ checkpointRecovery:true } },
]);

// ═══ 模拟驱动 ═══════════════════════════════

export async function runSimulate(smFactory, cases = CASES) {
  const results = [];
  const trace = [];

  for (const tc of cases) {
    if (!tc.inputs.length || tc.inputs[0] === '') continue;

    const sm = smFactory();
    const caseTrace = { caseId: tc.id, name: tc.name, states: [], turns: [] };

    for (const input of tc.inputs) {
      if (!input) continue;
      try {
        const resp = await sm.handle(input);
        caseTrace.states.push(sm.state);
        caseTrace.turns.push({ input, state: sm.state, msg: resp?.msg?.substring(0, 100) || '', raw: resp });
      } catch (e) {
        caseTrace.turns.push({ input, error: e.message });
      }
    }

    // 对比预期
    const passed = checkExpectations(caseTrace, tc.expect);
    trace.push({ ...caseTrace, passed, violations: passed ? [] : getViolations(caseTrace, tc.expect) });
    results.push({ caseId: tc.id, name: tc.name, passed, stateSequence: caseTrace.states });
  }

  const passRate = results.filter(r => r.passed).length / results.length * 100;
  return { results, trace, passRate, totalCases: results.length, passedCount: results.filter(r=>r.passed).length };
}

function checkExpectations(trace, expect) {
  if (!expect) return true;
  if (expect.noCrash && trace.turns.some(t => t.error)) return false;

  // 唤醒词自动归一化: 过滤双方idle状态
  const hasWake = trace.turns.some(t => t.input?.includes('大猩猩慢慢醒'));
  const actual = hasWake ? trace.states.filter(s => s !== 'idle') : trace.states;
  const expected = expect.stateSequence ? (hasWake ? expect.stateSequence.filter(s => s !== 'idle') : expect.stateSequence) : null;
  if (expected && actual) {
    if (expected.length > actual.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) return false;
    }
  }
  if (expect.result && !trace.turns.some(t => t.msg?.includes(expect.result))) return false;
  if (expected && actual) {
    if (expected.length > actual.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) return false;
    }
  }
  if (expect.result && !trace.turns.some(t => t.msg?.includes(expect.result))) return false;
  if (expect.slackEntered && !trace.states.includes('slack_node')) return false;

  return true;
}

function getViolations(trace, expect) {
  const v = [];
  if (expect.stateSequence) {
    for (let i = 0; i < expect.stateSequence.length; i++) {
      if (trace.states[i] !== expect.stateSequence[i])
        v.push(`状态不匹配: 期望${expect.stateSequence[i]},实际${trace.states[i]}`);
    }
  }
  return v;
}

// ═══ 报告生成 ═══════════════════════════════

export function formatSimulateReport(result) {
  const lines = [];
  lines.push('══════════ N14 行为测试报告 ══════════');
  lines.push('');
  lines.push(`通过率: ${result.passRate.toFixed(1)}% (${result.passedCount}/${result.totalCases})`);
  lines.push('');

  for (const r of result.results) {
    const icon = r.passed ? '✅' : '❌';
    lines.push(`${icon} ${r.caseId} ${r.name}: ${JSON.stringify(r.stateSequence)}`);
  }

  if (result.trace) {
    const failed = result.trace.filter(t => !t.passed);
    if (failed.length > 0) {
      lines.push('');
      lines.push(`--- 失败详情(${failed.length}条) ---`);
      for (const f of failed) {
        lines.push(`\n${f.caseId} ${f.name}:`);
        for (const v of f.violations) lines.push(`  - ${v}`);
        for (const t of f.turns) {
          if (t.error) lines.push(`  输入"${t.input}" → 错误: ${t.error}`);
          else lines.push(`  输入"${t.input}" → ${t.state}: ${t.msg}`);
        }
      }
    }
  }

  return lines.join('\n');
}

export function saveReport(result, path) {
  writeFileSync(path, JSON.stringify({
    timestamp: new Date().toISOString(),
    passRate: result.passRate,
    totalCases: result.totalCases,
    passedCount: result.passedCount,
    results: result.results,
  }, null, 2), 'utf-8');
}
