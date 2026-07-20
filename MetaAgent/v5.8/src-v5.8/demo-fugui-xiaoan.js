// @MetaAgent v5.8 — demo-fugui-xiaoan.js
// 驱动 MetaAgent 为富贵小安走完 P0→N15 态控设计流程
import { MetaAgent } from './index.js';

const STEPS = [
  // P0: 认知加载
  '帮我设计一个记账智能体，叫"富贵小安"。极简语音记账，说"今天午饭25块"就自动记录。',
  // P0→N1: 确认理解，进入场景定义
  '我了解态控体系，我们直接开始设计。',
  // N1: 场景定义细化
  '任务就是语音记账，输入一句话提取金额和类别。意图有6种：记账、查询、删除、对比、退出、其他。',
  // N1→N2: 确认边界，进入测试
  '场景定义好了，开始边界测试。',
  // N2→N3: 边界测试完成
  '边界测试通过，进入状态枚举。',
  // N3: 状态枚举
  '帮我枚举状态：IDLE→LISTENING→ANALYZING→IN_SESSION→...',
  // N3→N4: 状态枚举完成
  '状态枚举完成，画转移图。',
  // N4→N5: 路由表完成
  '转移图和路由表画好了，设计调度器。',
  // N5→N6: 调度器逻辑完成
  '调度器核心逻辑设计好，确认数据传递协议。',
  // N6→N7: 数据协议确认
  '数据协议确认，开始写根宪法。',
  // N7→N8: 根宪法完成
  '根宪法写好，做机制核查。',
  // N8→N9: 机制核查通过
  '机制核查通过，写环节宪法。',
  // N9→N10: 环节宪法完成
  '环节宪法写完，声明可调参数。',
  // N10→N11: 参数声明完成
  '参数声明完成，做契约对齐。',
  // N11→N12: 契约对齐完成 (field_based)
  'pass',
  // N12→N13: 拆包完成 (field_based)
  'v5.8',
  // N13→N14: 骨架代码完成
  '骨架代码生成完成，审骨架。',
  // N14→N15: 审骨架通过
  '审骨架通过，调参交付。',
];

async function main() {
  const meta = new MetaAgent();
  await meta.init();

  const initResp = await meta.startSession(`fugui-xiaoan-${Date.now()}`);
  console.log('════════════════════════════════════');
  console.log('  MetaAgent v5.8 — 富贵小安 P0→N15');
  console.log('════════════════════════════════════\n');
  console.log(`[${initResp.state}] ${initResp.message}\n`);

  let stepIdx = 0;
  for (const msg of STEPS) {
    stepIdx++;
    console.log(`\n────────────────────────────────────`);
    console.log(`  Step ${stepIdx}/${STEPS.length}: ${msg.slice(0, 50)}...`);
    console.log(`────────────────────────────────────\n`);

    const startTime = Date.now();
    const resp = await meta.sendMessage(msg);
    const elapsed = Date.now() - startTime;

    console.log(`[${resp.state}] intent=${resp.intent || 'none'} prob=${resp.probability?.toFixed(3) || 'N/A'} turnType=${resp.turnType || 'none'} (${elapsed}ms)`);
    console.log(`\n${resp.content}\n`);
  }

  console.log('\n════════════════════════════════════');
  console.log('  全流程完成');
  console.log('════════════════════════════════════\n');

  const metrics = meta.getMetrics();
  console.log('metrics:', JSON.stringify(metrics, null, 2));

  await meta.destroy();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
