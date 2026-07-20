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

  // 补全：网页界面（双击 index.html 即用）
  writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8"><title>我的智能体</title>
<style>body{font-family:system-ui;max-width:600px;margin:20px auto;padding:0 16px;background:#1a1a2e;color:#eee}
h1{text-align:center;color:#e94560;font-size:1.4em}
#chat{background:#16213e;border-radius:12px;padding:16px;min-height:300px;max-height:60vh;overflow-y:auto;margin-bottom:12px}
.msg{margin:8px 0;padding:10px 14px;border-radius:10px;max-width:85%}
.u{background:#e94560;color:#fff;margin-left:auto}
.a{background:#0f3460;margin-right:auto}
.i{font-size:.7em;color:#aaa;margin-bottom:4px}
#b{display:flex;gap:8px}
#b input{flex:1;padding:12px;border:none;border-radius:8px;background:#0f3460;color:#fff;font-size:1em}
#b button{padding:12px 20px;background:#e94560;color:#fff;border:none;border-radius:8px;font-size:1em}
#s{text-align:center;color:#888;font-size:.8em;margin:8px 0}</style>
<script type="importmap">{"imports":{"metaagent-v5":"https://esm.sh/metaagent-v5"}}</script></head><body>
<h1>🤖 我的智能体</h1><div id="chat"></div>
<div id="b"><input id="m" placeholder="输入指令..." autofocus><button onclick="S()">发送</button></div>
<div id="s">加载中...</div>
<script type="module">
import{createAgent}from'metaagent-v5';
window.A=await createAgent({l3Path:'./l3-v5.8'});await window.A.startSession('web');
document.getElementById('s').textContent='就绪';
window.S=async()=>{let i=document.getElementById('m'),t=i.value.trim();if(!t)return;i.value='';
let d=document.getElementById('chat'),e=document.createElement('div');e.className='msg u';e.textContent=t;d.appendChild(e);
document.getElementById('s').textContent='思考中...';
try{let r=await window.A.sendMessage(t);e=document.createElement('div');e.className='msg a';
e.innerHTML='<div class=i>['+r.intent+']</div>'+r.content.replace(/\\n/g,'<br>');d.appendChild(e)}
catch(x){e=document.createElement('div');e.className='msg a';e.textContent='出错了';d.appendChild(e)}
document.getElementById('s').textContent='就绪';d.scrollTop=d.scrollHeight};
document.getElementById('m').addEventListener('keydown',e=>{if(e.key==='Enter')window.S()});
</script></body></html>
`, 'utf-8');
  console.log('  ✓ index.html (网页界面——双击即用)');

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
