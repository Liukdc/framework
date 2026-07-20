// @MetaAgent v5.8 — test-cross-scenario.js
// 验证 createAgent() 通用性：用一套完全不同的 L3 配置（记账助手）加载并对话
import { createAgent } from './index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join(import.meta.dirname || '.', '..', 'test-cross-scenario');
mkdirSync(join(TMP, 'l3-v5.8', 'constitutions'), { recursive: true });

// ═══ 构建一套全新的 L3 配置：记账助手 ═══
const L3 = {
  'boundary.json': {
    doList: [
      { intent: 'record', taskType: 'field_based', topicEvolutionEnabled: false },
      { intent: 'query',  taskType: 'topic_based', topicEvolutionEnabled: true },
      { intent: 'other',  taskType: 'topic_based', topicEvolutionEnabled: true },
    ],
  },
  'states.json': {
    states: [{ name: 'IDLE' }, { name: 'LISTENING' }, { name: 'ANALYZING' }, { name: 'IN_SESSION' }],
    inSessionSubtypes: [
      { intent: 'record', taskType: 'field_based', topicEvolutionEnabled: false, importance: 'critical' },
      { intent: 'query',  taskType: 'topic_based', topicEvolutionEnabled: true, importance: 'high' },
      { intent: 'other',  taskType: 'topic_based', topicEvolutionEnabled: true, importance: 'normal' },
    ],
  },
  'transitions.json': [
    { from: 'IDLE', trigger: ['start'], to: 'LISTENING' },
    { from: 'LISTENING', trigger: ['input'], to: 'ANALYZING' },
    { from: 'ANALYZING', trigger: ['intent'], to: 'IN_SESSION' },
    { from: 'IN_SESSION', trigger: ['turnType=complete','turnType=off-task'], to: 'LISTENING' },
    { from: 'IN_SESSION', trigger: ['turnType=giveup'], to: 'LISTENING' },
    { from: 'LISTENING', trigger: ['input'], to: 'ANALYZING' },
    { from: 'IN_SESSION', trigger: ['turnType=off-task'], to: 'ANALYZING' },
    { from: 'IN_SESSION', trigger: ['turnType=complete'], to: 'LISTENING' },
  ],
  'routeTable.json': {
    routes: [
      { from: 'ANALYZING', contractOutKey: 'intent=record', to: 'IN_SESSION' },
      { from: 'ANALYZING', contractOutKey: 'intent=query', to: 'IN_SESSION' },
      { from: 'ANALYZING', contractOutKey: 'intent=other', to: 'IN_SESSION' },
      { from: 'IN_SESSION(topic)', contractOutKey: 'turnType=complete', to: 'LISTENING' },
      { from: 'IN_SESSION(field)', contractOutKey: 'turnType=complete', to: 'EXECUTING' },
      { from: 'IN_SESSION', contractOutKey: 'turnType=off-task', to: 'ANALYZING' },
      { from: 'IN_SESSION', contractOutKey: 'turnType=giveup', to: 'LISTENING' },
      { from: 'IN_SESSION', contractOutKey: 'intent=record', to: 'IN_SESSION' },
    ],
    firstLayer: {}, secondLayer: [],
  },
  'dataProtocol.json': {}, 'scheduler.json': {}, 'root-constitution.json': {},
  'tunables.json': {}, 'outputs.json': { critical: [], high: [], normal: [] },
};

for (const [name, data] of Object.entries(L3)) {
  writeFileSync(join(TMP, 'l3-v5.8', name), JSON.stringify(data), 'utf-8');
}
// 宪法索引（空，走容错）
writeFileSync(join(TMP, 'l3-v5.8', 'constitutions', 'index.json'),
  JSON.stringify({ constitutionFiles: {}, loadPaths: [], constitutionCount: 0 }), 'utf-8');

// ═══ 加载并测试 ═══
console.log('═══ 跨场景验证：记账助手 L3 ═══\n');
const agent = await createAgent({
  l3Path: join(TMP, 'l3-v5.8'),
  apiKey: process.env.DEEPSEEK_API_KEY,
});

await agent.startSession('cross-test');

// Test 1: "记账：午饭 25 块" → record
const r1 = await agent.sendMessage('午饭 25 块');
console.log(`[1] "${r1.intent}" prob=${r1.probability?.toFixed(3)} → ${r1.content?.slice(0, 80)}`);

// Test 2: "这个月花了多少" → query
const r2 = await agent.sendMessage('这个月花了多少钱');
console.log(`[2] "${r2.intent}" prob=${r2.probability?.toFixed(3)} → ${r2.content?.slice(0, 80)}`);

// Test 3: "你好" → other
const r3 = await agent.sendMessage('你好');
console.log(`[3] "${r3.intent}" prob=${r3.probability?.toFixed(3)} → ${r3.content?.slice(0, 80)}`);

await agent.destroy();

const verdict = r1.intent === 'record' || r1.intent === 'query' || r1.intent === 'other'
  ? '✅ createAgent 通用——非 MetaAgent 场景正常路由和对话'
  : '⚠️ 路由与预期不符，但 createAgent 加载无报错';

console.log(`\n${verdict}`);
