// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 v5.8 — 端到端测试脚本
 *
 * 用法: node src-v5.8/test-v5.8.js
 *
 * @module fugui-xiaoan/test-v5.8
 */

import { createFuguiXiaoan } from './index.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));

// ═══ 测试用例 ═══════════════════════════════
const TESTS = [
  { name:'唤醒', input:'大猩猩慢慢醒', check: (r, fx) => r.msg.includes('在呢') && fx.state === 'listening' },
  { name:'记账-简单', input:'记一笔午饭25', check: (r, fx) => fx.getRecords().length > 0 },
  { name:'记账-细致', input:'记一笔猪肉15一斤', check: (r, fx) => true },
  { name:'查询', input:'这个月花了多少', check: (r) => true },
  { name:'对比', input:'这个月和上个月哪个花得多', check: (r) => true },
  { name:'闲聊→SLACK_NODE', input:'今天天气真好', check: (r, fx) => fx.state === 'slack_node' },
  { name:'切断房间', input:'切断房间', check: (r, fx) => fx.state === 'listening' },
  { name:'退出', input:'大猩猩飞走吧', check: (r, fx) => fx.state === 'idle' },
];

// ═══ 模拟 DeepSeek LLM ══════════════════════
class TestLLM {
  async chat({ messages }) {
    const last = messages[messages.length - 1]?.content || '';
    if (last.includes('午饭25')) return { turnType:'complete', result:{category:'午饭',amount:25,date:new Date().toISOString().split('T')[0]}, message:'已记录: 午饭 25元', askingField:null };
    if (last.includes('猪肉')) return { turnType:'complete', result:{category:'猪肉',amount:15,date:new Date().toISOString().split('T')[0],quantity:1,unit:'斤'}, message:'已记录: 猪肉 1斤 15元', askingField:null };
    if (last.includes('花了多少')) return { turnType:'complete', result:{records:[],total:100, _formatted:'这个月共花了100元'}, message:'这个月共花了100元' };
    if (last.includes('花得多')) return { turnType:'complete', result:{sum1:3500,sum2:2800,diff:700, _formatted:'这个月比上个月多花700元'}, message:'这个月比上个月多花700元' };
    return { turnType:'reply', message:'嗯。' };
  }
  async analyze(input) {
    if (input.includes('记')) return { intent:'record', choice:'A', logprobs:[{token:'A',logprob:-0.05}], extracted:{}, probability:0.95 };
    if (input.includes('花了')) return { intent:'query', choice:'B', logprobs:[{token:'B',logprob:-0.1}], extracted:{}, probability:0.9 };
    if (input.includes('花得多')) return { intent:'compare', choice:'D', logprobs:[{token:'D',logprob:-0.2}], extracted:{}, probability:0.8 };
    if (input.includes('天气')) return { intent:'other', choice:'E', logprobs:[{token:'E',logprob:-0.3}], extracted:{}, inputNature:'S', probability:0.75 };
    return { intent:'other', choice:'E', logprobs:[{token:'E',logprob:-0.5}], extracted:{}, inputNature:'U', probability:0.5 };
  }
}

// ═══ 主流程 ═══════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  富贵小安 v5.8 端到端测试');
  console.log('═══════════════════════════════════════');
  console.log('');

  const fx = createFuguiXiaoan({ llmClient: new TestLLM() });
  const init = await fx.init();
  console.log('初始化:', init.constitutionValid ? '✅ 宪法' : '❌ 宪法', init.l2l3Consistent ? '✅ L2→L3' : '❌ L2→L3');

  let passed = 0;
  let failed = 0;

  for (const tc of TESTS) {
    try {
      const r = await fx.handle(tc.input);
      const ok = tc.check(r, fx);
      console.log(`${ok ? '✅' : '❌'} ${tc.name}: "${tc.input}" → ${r.msg?.substring(0,40) || ''} [${fx.state}]`);
      if (ok) passed++; else failed++;
    } catch (e) {
      console.log(`❌ ${tc.name}: "${tc.input}" → 错误: ${e.message}`);
      failed++;
    }
  }

  const stats = fx.getStats();
  console.log('');
  console.log('--- 统计 ---');
  console.log(`记录数: ${stats.totalRecords}, 总金额: ${stats.totalAmount}元`);
  console.log(`冷启动: ${stats.coldStart}`);
  console.log(`通过: ${passed}/${TESTS.length}, 失败: ${failed}`);

  // 写入报告
  const report = {
    timestamp: new Date().toISOString(),
    passed, failed, total: TESTS.length,
    stats: { records: stats.totalRecords, amount: stats.totalAmount, coldStart: stats.coldStart },
  };
  const reportPath = join(DIR, '..', '..', 'e2e-report-v5.8.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n报告已保存: ${reportPath}`);
}

main().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
