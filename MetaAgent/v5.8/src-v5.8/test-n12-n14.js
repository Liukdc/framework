// @MetaAgent v5.8 — test-n12-n14.js
// 测试 N12→N13→N14 代码生成链路（含 mock 降级）
import { createAgent } from './index.js';

// N12 需要 L2 拆包上下文；N13 需要 N12 产出做骨架生成；N14 审 N13
const STEPS = [
  // N12: L2→L3 拆包 (field_based，只输出版本号)
  '契约对齐确认完成。现在进行L2→L3拆包：将 N1-N10 的 L2 文档拆为 L3 生成包（boundary/states/routeTable/tunables/dataProtocol/scheduler/root-constitution/outputs 共 8 个 JSON）。版本号确定为 v5.8。',

  // N13: 骨架代码生成 (topic_based，需要代码专项模型)
  'L3拆包完成。现在基于 L3 生成包生成骨架代码：需要 scheduler.js（五层过滤）、state-machine.js（8状态+18子类型）、route-table.js（12路由）、context-manager.js（三层注入）、tunables.js（25参数）、contract-store.js（SQLite+FTS5）、deepseek-adapter.js（API适配+logprobs）、constitutions/loader.js（18宪法加载）。所有文件用 ESM，加文件头注释 @MetaAgent v5.8。',

  // N14: 审骨架 (检查 N13 输出的代码)
  '骨架代码生成完成。现在审骨架：静态检查（硬编码/CJS残留/L3 JSON有效性/tunable声明/宪法引用）、行为测试（7个case+6种turnType）、机制检查（五层过滤/N2双角色/N13代码模型/topicEvolution/S3/降级链/宪法/工具分层/状态转移/sessionCheckpoint/上下文注入）。输出审查报告。',
];

async function main() {
  const meta = await createAgent();
  const sessionId = `n12-n14-${Date.now()}`;
  const initResp = await meta.startSession(sessionId);

  console.log('═══════════════════════════════════');
  console.log('  N12→N13→N14 代码生成链路测试');
  console.log('═══════════════════════════════════\n');
  console.log(`[${initResp.state}] ${initResp.message}\n`);

  let step = 0;
  for (const msg of STEPS) {
    step++;
    console.log(`\n── Step ${step}/${STEPS.length} ──`);
    console.log(`  ${msg.slice(0, 60)}...\n`);

    const start = Date.now();
    const resp = await meta.sendMessage(msg);
    const elapsed = Date.now() - start;

    console.log(`[${resp.state}] intent=${resp.intent} prob=${resp.probability?.toFixed(3)} turnType=${resp.turnType} (${elapsed}ms)`);
    console.log(resp.content?.slice(0, 800));
    if (resp.content?.length > 800) console.log('...[truncated]');
  }

  console.log('\n═══════════════════════════════════');
  console.log('  metrics:', JSON.stringify(meta.getMetrics(), null, 2));

  // 检查产出物
  console.log('\n── 产出物检查 ──');
  const outputs = await meta.getOutputs();
  console.log(`  总产出物: ${outputs.length} 件`);
  outputs.forEach(o => console.log(`  - ${o.intent}: ${o.output_name} (${o.importance})`));

  await meta.destroy();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
