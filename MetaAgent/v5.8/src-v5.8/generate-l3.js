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

  // 补全：网页界面——通用聊天框，加载本地 L3 配置
  writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>我的智能体</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#1a1a2e;color:#eee;height:100dvh;display:flex;flex-direction:column;max-width:500px;margin:0 auto}header{background:#16213e;padding:12px 16px;border-bottom:1px solid #0f3460;text-align:center}h1{font-size:1em;color:#e94560}#chat{flex:1;overflow-y:auto;padding:12px}.m{display:flex;margin:8px 0}.m.u{justify-content:flex-end}.m .b{padding:10px 14px;border-radius:12px;max-width:80%;word-break:break-word;line-height:1.5}.m.u .b{background:#e94560;color:#fff}.m.a .b{background:#0f3460}.m .l{font-size:.65em;color:#888;margin-bottom:3px}#bar{display:flex;padding:10px;gap:8px;background:#16213e}#bar input{flex:1;padding:10px 14px;border:none;border-radius:20px;background:#0f3460;color:#fff;font-size:.95em;outline:none}#bar button{width:40px;height:40px;border:none;border-radius:50%;background:#e94560;color:#fff;font-size:1.2em;cursor:pointer}#empty{text-align:center;color:#555;padding:40px 0}</style>
<script type="importmap">{"imports":{"metaagent-v5":"https://esm.sh/metaagent-v5"}}</script></head><body>
<header><h1>🤖 我的智能体</h1></header>
<div id="chat"><div id="empty">你好！说说你想做什么</div></div>
<div id="bar"><input id="in" placeholder="输入指令..." autofocus><button onclick="S()">↑</button></div>
<script type="module">
import{createAgent}from'metaagent-v5';
const APIKEY = localStorage.getItem('apikey') || '';
window.agent = await createAgent({ l3Path:'./l3-v5.8', apiKey:APIKEY });
await window.agent.startSession('ui');
document.getElementById('empty').textContent = APIKEY ? '真模型就绪' : 'Mock 模式 · 粘 API key 切换真模型';
window.S = async () => {
  const el=document.getElementById('in'), t=el.value.trim(); if(!t)return; el.value='';
  document.getElementById('empty')?.remove();
  const c=document.getElementById('chat');
  let d=document.createElement('div');d.className='m u';d.innerHTML='<div class=b>'+t+'</div>';c.appendChild(d);
  const r=await window.agent.sendMessage(t);
  d=document.createElement('div');d.className='m a';
  d.innerHTML='<div class=b><div class=l>['+r.intent+']</div>'+r.content.replace(/\\n/g,'<br>')+'</div>';
  c.appendChild(d);c.scrollTop=c.scrollHeight;
};
document.getElementById('in').addEventListener('keydown',e=>{if(e.key=='Enter')S()});
window.setKey = k => { localStorage.setItem('apikey',k); location.reload(); };
</script></body></html>
`, 'utf-8');
  console.log('  ✓ index.html (双击即用——通用智能体界面)');

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
