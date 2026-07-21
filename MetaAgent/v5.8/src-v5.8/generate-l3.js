// @MetaAgent v5.8 — generate-l3.js
// L2→L3 自动生成：给定输出目录，由 MetaAgent N12 拆包产出完整 L3 JSON 配置包
// 用法: node generate-l3.js --out ./my-agent/

import { createAgent } from './index.js';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(import.meta.dirname || '.', '..', 'generated-agent');

const L3_FILES = [
  'boundary.json', 'states.json', 'transitions.json', 'routeTable.json',
  'dataProtocol.json', 'scheduler.json', 'root-constitution.json', 'tunables.json', 'outputs.json',
];

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'l3-v5.8'), { recursive: true });

  const agent = await createAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    outputDir: OUT,
  });
  await agent.startSession('gen-l3');

  console.log('═══ L2→L3 自动生成 ═══');
  console.log(`  输出目录: ${OUT}/l3-v5.8/\n`);

  const prompts = [
    '进行L2→L3拆包，先写 boundary.json 和 states.json',
    '拆包继续，写 transitions.json 和 routeTable.json',
    '拆包继续，写 dataProtocol.json 和 scheduler.json',
    '拆包继续，写 root-constitution.json 和 tunables.json',
    '拆包完成，写 outputs.json。完成后输出 v5.8',
  ];

  for (const p of prompts) {
    const r = await agent.sendMessage(p);
    console.log(`  [${r.intent}] ${r.content?.slice(0, 60).replace(/\n/g, ' ')}`);
  }

  await agent.destroy();

  // ═══ 状态机可视化校验 ═══
  console.log('');
  const { execSync } = await import('node:child_process');
  try {
    const viz = execSync(
      `C:/Users/qq431/.workbuddy/binaries/node/versions/22.22.2/node.exe "${__dirname || '.'}/viz-fsm.js" --l3 "${join(OUT, 'l3-v5.8')}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    // 写出 fsm.md
    writeFileSync(join(OUT, 'fsm.md'), viz, 'utf-8');
    console.log('  ✓ fsm.md (状态机流程图)');
    // 检查完整性
    if (viz.includes('⚠')) {
      const warnings = viz.split('\n').filter(l => l.includes('⚠'));
      for (const w of warnings.slice(0, 5)) console.log(`  ${w.trim()}`);
    } else {
      console.log('  ✅ 完整性检查通过');
    }
  } catch (err) {
    console.log(`  ⚠️ 可视化失败: ${err.message?.slice(0, 60)}`);
  }

  // 补全：生成入口 index.js（让产出能独立 node 跑）
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, 'index.js'), `// 由 MetaAgent v5.8 生成
import { createAgent } from 'metaagent-v5';

const agent = await createAgent({ l3Path: './l3-v5.8' });
await agent.startSession('run');

// 替换为你的业务逻辑
async function chat(input) {
  const resp = await agent.sendMessage(input);
  console.log(\`[\${resp.intent}] \${resp.content.slice(0, 200)}\`);
  return resp;
}

// CLI 模式
const input = process.argv[2];
if (input) {
  await chat(input);
  await agent.destroy();
} else {
  console.log('Agent 已就绪。用法: node index.js "你的输入"');
  // 交互模式略——调用方自己处理
}
`, 'utf-8');
  console.log('  ✓ index.js (SDK 入口)');

  // 检查产出
  const dir = join(OUT, 'l3-v5.8');
  const existing = [];
  for (const f of L3_FILES) {
    const { statSync } = await import('node:fs');
    const p = join(dir, f);
    try { existing.push(`${f} (${statSync(p).size}B)`); } catch { existing.push(`${f} ✗`); }
  }
  console.log(`\n✅ 生成完成: ${existing.filter(s => !s.endsWith('✗')).length}/${L3_FILES.length} 文件`);
  console.log(existing.map(s => `  - ${s}`).join('\n'));
  console.log(`\n加载: const agent = await createAgent({ l3Path: '${OUT}/l3-v5.8' })`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
