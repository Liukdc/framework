// @MetaAgent v5.8 — n16-package.js
// N16 打包交付：将 L3 JSON 状态机说明书打包为可安装的 npm 包
// 用法: node n16-package.js --l3 ./agent-output/l3-v5.8 --name my-agent --out ./my-agent-pkg
//
// 产出:
//   my-agent-pkg/
//     ├── index.js          ← SDK 入口（createAgent 加载 L3）
//     ├── package.json      ← 可直接 npm publish
//     ├── l3-v5.8/          ← 锁定版 L3 配置
//     ├── README.md         ← 自动生成
//     └── my-agent-1.0.0.tgz ← npm pack 产物（可分发）

import { createAgent } from './index.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(import.meta.dirname || '.', '..', 'n16-output');

const L3_SRC = process.argv.includes('--l3')
  ? process.argv[process.argv.indexOf('--l3') + 1]
  : join(import.meta.dirname || '.', '..', 'agent-output', 'real-test', 'l3-v5.8');

const AGENT_NAME = process.argv.includes('--name')
  ? process.argv[process.argv.indexOf('--name') + 1]
  : null;

const L3_FILES = [
  'boundary.json', 'states.json', 'transitions.json', 'routeTable.json',
  'dataProtocol.json', 'scheduler.json', 'root-constitution.json', 'tunables.json', 'outputs.json',
];

async function main() {
  // ═══ Step 1: 读取 L3，提取 agent 名称 ═══
  if (!existsSync(L3_SRC)) {
    console.error(`[N16] L3 目录不存在: ${L3_SRC}`);
    process.exit(1);
  }

  let agentName = AGENT_NAME || 'my-agent';
  let pkgVersion = '1.0.0';
  let description = '由 MetaAgent v5.8 生成的智能体';

  try {
    const boundary = JSON.parse(readFileSync(join(L3_SRC, 'boundary.json'), 'utf-8'));
    if (boundary.doList && boundary.doList.length > 0) {
      agentName = boundary.doList[0].intent + '-agent';
    }
  } catch {}

  // ═══ Step 2: 创建包目录 ═══
  mkdirSync(OUT, { recursive: true });
  const l3Dir = join(OUT, 'l3-v5.8');
  mkdirSync(l3Dir, { recursive: true });
  const constDir = join(l3Dir, 'constitutions');
  if (!existsSync(constDir)) mkdirSync(constDir, { recursive: true });

  // ═══ Step 3: 复制 L3 JSON（锁定版） ═══
  let copied = 0;
  for (const f of L3_FILES) {
    const src = join(L3_SRC, f);
    const dst = join(l3Dir, f);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      copied++;
    }
  }
  // 复制宪法
  const constSrc = join(L3_SRC, 'constitutions');
  if (existsSync(constSrc)) {
    try {
      const { readdirSync: ls } = await import('node:fs');
      for (const f of ls(constSrc)) {
        copyFileSync(join(constSrc, f), join(constDir, f));
      }
    } catch {}
  }

  // 从默认配置补全缺失文件
  const defL3 = join(import.meta.dirname || '.', '..', 'l3-v5.8');
  if (existsSync(defL3)) {
    for (const f of L3_FILES) {
      const dst = join(l3Dir, f);
      if (!existsSync(dst) && existsSync(join(defL3, f))) {
        copyFileSync(join(defL3, f), dst);
        copied++;
      }
    }
    // 补 cons/index.json
    const di = join(constDir, 'index.json');
    const diSrc = join(defL3, 'constitutions', 'index.json');
    if (!existsSync(di) && existsSync(diSrc)) copyFileSync(diSrc, di);
  }

  console.log(`[N16] L3 文件: ${copied}/${L3_FILES.length}`);

  // ═══ Step 4: 生成 package.json ═══
  const pkg = {
    name: agentName,
    version: pkgVersion,
    description,
    type: 'module',
    main: 'index.js',
    dependencies: { 'metaagent-v5': '^5.8.0' },
    scripts: { start: 'node index.js' },
    files: ['index.js', 'l3-v5.8/', 'README.md'],
    keywords: ['ai-agent', 'state-machine', 'metaagent'],
    license: 'MIT',
  };
  writeFileSync(join(OUT, 'package.json'), JSON.stringify(pkg, null, 2));
  console.log(`[N16] package.json → ${agentName}`);

  // ═══ Step 5: 生成 index.js ═══
  writeFileSync(join(OUT, 'index.js'), `// ${agentName} — 由 MetaAgent v5.8 生成
import { createAgent } from 'metaagent-v5';

const agent = await createAgent({ l3Path: new URL('./l3-v5.8', import.meta.url).pathname });
await agent.startSession('run');

export { agent };

// CLI: node index.js "你的输入"
const input = process.argv[2];
if (input) {
  const resp = await agent.sendMessage(input);
  console.log(\`[\${resp.intent}] \${resp.content.slice(0, 500)}\`);
  await agent.destroy();
}
`);
  console.log('[N16] index.js');

  // ═══ Step 6: 生成 README.md ═══
  const intents = [];
  try {
    const b = JSON.parse(readFileSync(join(l3Dir, 'boundary.json'), 'utf-8'));
    for (const d of b.doList || []) {
      intents.push(`- **${d.intent}** (${d.taskType || 'topic_based'})`);
    }
  } catch {}

  writeFileSync(join(OUT, 'README.md'), `# ${agentName}

${description}

## 意图清单
${intents.join('\n') || '- 待定义'}

## 使用
\`\`\`bash
npm install
node index.js "你的输入"
\`\`\`

或作为库：
\`\`\`js
import { agent } from '${agentName}';
const resp = await agent.sendMessage('你的输入');
\`\`\`

## 依赖
- metaagent-v5 >= 5.8.0
- Node.js >= 18
`);
  console.log('[N16] README.md');

  // ═══ Step 7: 打包验证 ═══
  try {
    const { execSync } = await import('node:child_process');
    const result = execSync('npm pack --json', { cwd: OUT, encoding: 'utf-8', timeout: 30000 });
    const tgz = JSON.parse(result)[0];
    console.log(`[N16] ✅ 打包完成: ${tgz.filename} (${(tgz.size / 1024).toFixed(1)}KB)`);
  } catch {
    console.log('[N16] ⚠️ npm pack 不可用（可能未装 npm），包目录可直接使用或手动 npm publish');
  }

  // ═══ Step 8: 加载验证 ═══
  console.log('[N16] 加载验证...');
  try {
    const agent = await createAgent({ l3Path: l3Dir });
    await agent.startSession('n16-verify');
    const r = await agent.sendMessage('你好');
    console.log(`[N16] ✅ 状态机可用: intent=${r.intent} prob=${r.probability?.toFixed(2)}`);
    await agent.destroy();
  } catch (err) {
    console.log(`[N16] ⚠️ 加载验证失败: ${err.message.slice(0, 100)}`);
  }

  console.log(`\n✅ N16 完成: ${OUT}/`);
  console.log(`   安装: cd ${OUT} && npm install && node index.js "指令"`);
  console.log(`   发布: cd ${OUT} && npm publish --access public`);
}

main().catch(err => { console.error('[N16] FATAL:', err); process.exit(1); });
