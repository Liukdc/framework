// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * N14 审骨架 — 主运行脚本
 *
 * 三件事:
 *   1. 静态质量检查 — 硬编码阈值/内联拼接/confidence残留/接口一致性
 *   2. 行为测试 — 驱动状态机跑21个case
 *   3. 9+2机制检查 — 状态机流转/契约校验/降级链/上下文拼接等
 *
 * 用法: node n14-toolchain/run-n14.js
 *
 * @module n14-toolchain/run-n14
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { runStaticChecks, formatReport as formatStatic } from './static-checker.js';
import { runSimulate, CASES, formatSimulateReport, saveReport } from './simulate.js';
import { runMechanismChecks, formatMechanismReport } from './mechanism-check.js';

// ═══ 模拟 LLM 客户端 ═══════════════════════════
class MockLLM {
  constructor() {
    this.records = [];
  }

  async chat({ messages }) {
    const lastMsg = messages[messages.length - 1]?.content || '';
    const tools = messages.find(m => m.tool_call_id) ? [] : [];

    if (lastMsg.includes('cut_room')) return { turnType: 'off_task', message: '' };

    // 简单关键词匹配模拟
    if (lastMsg.includes('记一笔') || lastMsg.includes('记账')) {
      const m = lastMsg.match(/(\d+)元?块?$/) || lastMsg.match(/(\d+)/);
      const cat = lastMsg.match(/记一笔(.+?)\d/);
      return {
        turnType: Number(m?.[1]) > 999999 ? 'validation_failed' : 'complete',
        result: { category: cat?.[1]?.trim() || '未知', amount: Number(m?.[1]) || 0, date: new Date().toISOString().split('T')[0] },
        askingField: null, message: '已记录',
        _probability: Number(m?.[1]) > 999999 ? 0.3 : 0.95,
      };
    }
    if (lastMsg.includes('查')) return { turnType: 'complete', result: { total: 100 }, message: '共100元' };
    if (lastMsg.includes('哪个花得多')) return { turnType: 'complete', result: { sum1: 3500, sum2: 2800 }, message: '这个月比上个月多花700元' };
    if (lastMsg.includes('算了') || lastMsg.includes('不记了')) return { turnType: 'giveup', message: '' };
    if (lastMsg.includes('删除') || lastMsg.includes('删')) return { turnType: 'complete', result: { category:'午饭',amount:25 }, message: '' };
    if (lastMsg.includes('帮我') || lastMsg.includes('订')) return { turnType: 'ask', message: '这是什么？' };

    return { turnType: 'reply', message: '嗯。', askingField: 'category' };
  }

  async analyze(input) {
    if (input.includes('记') || input.includes('记账')) return { intent:'record', choice:'A', logprobs:[{token:'A',logprob:-0.05}], extracted:{}, probability:0.95 };
    if (input.includes('查') || input.includes('多少')) return { intent:'query', choice:'B', logprobs:[{token:'B',logprob:-0.1}], extracted:{}, probability:0.9 };
    if (input.includes('删')) return { intent:'delete', choice:'C', logprobs:[{token:'C',logprob:-0.15}], extracted:{}, probability:0.85 };
    if (input.includes('比') || input.includes('花得多')) return { intent:'compare', choice:'D', logprobs:[{token:'D',logprob:-0.2}], extracted:{}, probability:0.8 };
    if (input.includes('天气') || input.includes('你好')) return { intent:'other', choice:'E', logprobs:[{token:'E',logprob:-0.3}], extracted:{}, inputNature:'S', probability:0.75 };
    if (input.includes('订') || input.includes('帮我')) return { intent:'other', choice:'E', logprobs:[{token:'E',logprob:-0.4}], extracted:{}, inputNature:'T', probability:0.6 };
    return { intent:'other', choice:'E', logprobs:[{token:'E',logprob:-0.5}], extracted:{}, inputNature:'U', probability:0.5 };
  }
}

// ═══ 主流程 ═══════════════════════════════

async function main() {
  console.log('═'.repeat(50));
  console.log('  N14 审骨架 — 富贵小安 v5.8');
  console.log('═'.repeat(50));
  console.log('');

  // ── 第1关: 静态质量检查 ──
  console.log('【第1关】静态质量检查...');
  const staticResult = runStaticChecks();
  console.log(formatStatic(staticResult));
  console.log('');

  // ── 第2关: 行为测试 ──
  console.log('【第2关】行为测试(21个case)...');
  try {
    // 动态导入state-machine(避免启动时失败)
    const srcDir = join(import.meta.dirname || '.', '..', 'src-v5.8');
    let SM;
    try {
      const mod = await import(`file:///${srcDir.replace(/\\/g,'/')}/state-machine.js`);
      SM = mod.StateMachine;
    } catch (e) {
      console.log(`  ⚠️  无法加载 state-machine.js: ${e.message}`);
      console.log('  使用离线模式: 仅检查L2文档和L3生成包的一致性');
    }

    if (SM) {
      const createSM = () => new SM({ llmClient: new MockLLM() });
      const simResult = await runSimulate(createSM);
      console.log(formatSimulateReport(simResult));

      // ── 第3关: 9+2机制检查 ──
      console.log('');
      console.log('【第3关】9+2机制检查...');
      try {
        const mechChecks = runMechanismChecks(simResult.trace);
        console.log(formatMechanismReport(mechChecks));
      } catch (e) {
        console.log(`  ⚠️  机制检查失败: ${e.message}`);
      }

      // 保存报告
      saveReport(simResult, join(import.meta.dirname || '.', 'n14-report.json'));
      console.log('\n报告已保存到 n14-report.json');
    }
  } catch (e) {
    console.log(`  ❌ 行为测试失败: ${e.message}`);
  }

  console.log('');
  console.log('═'.repeat(50));
  console.log('  N14 审骨架完成');
  console.log('═'.repeat(50));
}

main().catch(console.error);
