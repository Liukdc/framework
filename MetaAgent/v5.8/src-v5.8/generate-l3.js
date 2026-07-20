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
