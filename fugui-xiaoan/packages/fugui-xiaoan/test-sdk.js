// 富贵小安 SDK 化验证：createAgent 加载富贵小安 L3 配置
import { createAgent } from '../../../packages/metaagent/src-v5.8/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const L3 = join(__dirname, 'l3-v5.8');

console.log('═══ 富贵小安 SDK 化验证 ═══\n');

const agent = await createAgent({ l3Path: L3 });
await agent.startSession('fuxiao-test');

// Test 1: 记账
const r1 = await agent.sendMessage('午饭 25 块');
console.log(`1. "午饭 25 块" → intent=${r1.intent} prob=${r1.probability?.toFixed(3)}`);
console.log(`   ${r1.content?.slice(0, 80)}`);

// Test 2: 查询
const r2 = await agent.sendMessage('这个月花了多少钱');
console.log(`2. "这个月花了多少钱" → intent=${r2.intent} prob=${r2.probability?.toFixed(3)}`);
console.log(`   ${r2.content?.slice(0, 80)}`);

// Test 3: 闲聊 → other
const r3 = await agent.sendMessage('你好');
console.log(`3. "你好" → intent=${r3.intent} prob=${r3.probability?.toFixed(3)}`);
console.log(`   ${r3.content?.slice(0, 80)}`);

await agent.destroy();

const ok = r1.intent === 'record' && r2.intent === 'query' && r3.intent === 'other';
console.log(`\n${ok ? '✅' : '⚠️'} 富贵小安 SDK 化验证${ok ? '通过' : '部分通过'}`);
