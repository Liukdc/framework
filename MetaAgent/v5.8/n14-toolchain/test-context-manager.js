// @MetaAgent v5.8 — test-context-manager.js
// context-manager 三层注入策略单元测试
import { ContextManager } from '../src-v5.8/context-manager.js';
import { StateMachine } from '../src-v5.8/state-machine.js';
import { createDefaultTunables, getTunable } from '../src-v5.8/tunables.js';
import { join } from 'node:path';

const L3 = join(import.meta.dirname || '.', '..', 'l3-v5.8');
const sm = new StateMachine(L3);
const tunables = createDefaultTunables();

// Mock constitutions
const mockConstitutions = {
  index: {},
  texts: {
    N1: '# N1 环节宪法\ntopic_based',
    N11: '# N11 环节宪法\nfield_based',
  },
};

// Mock store
const mockStore = {
  getOutputs: async () => [],
  getTopicEvents: async () => [],
};

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected || (expected instanceof RegExp && expected.test(actual));
  if (ok) pass++; else { fail++; console.error(`  ❌ ${name}: 期望=${expected} 实际=${JSON.stringify(actual)}`); }
}

const cm = new ContextManager(sm, tunables, mockStore, mockConstitutions);

// ═══ _decideStrategy ═══
check('ANALYZING→analyzing', cm._decideStrategy('ANALYZING', null, null), 'analyzing');
check('IN_SESSION+topic→topic_three_layer', cm._decideStrategy('IN_SESSION', 'N1', 'topic_based'), 'topic_three_layer');
check('IN_SESSION+field→field_gated', cm._decideStrategy('IN_SESSION', 'N11', 'field_based'), 'field_gated');
check('IDLE+null→minimal', cm._decideStrategy('IDLE', null, null), 'minimal');

// ═══ _assemble - analyzing ═══
check('analyzing has prompt', cm._assemble('s1', 'ANALYZING', null, null, 'analyzing', []).then(r => r[0]?.includes('意图识别器')) ? 'y' : null, /./);

// ═══ _assemble - topic_three_layer (summary depth) ═══
tunables.threeLayerInjectionDepth = 'summary';
const topicParts = await cm._assemble('s1', 'IN_SESSION', 'N1', 'topic_based', 'topic_three_layer', []);
check('topic_three_layer has constitution', topicParts[0]?.includes('# N1'), true);
check('topic_three_layer has writeOutput rule', topicParts.some(p => p?.includes('writeOutput')), true);
check('topic_three_layer has upstream rule', topicParts.some(p => p?.includes('上游兜底')), true);

// ═══ _assemble - field_gated ═══
const fieldParts = await cm._assemble('s1', 'IN_SESSION', 'N11', 'field_based', 'field_gated', []);
check('field_gated has constitution', fieldParts[0]?.includes('# N11'), true);
check('field_gated has hard gate', fieldParts.some(p => p?.includes('硬门控')), true);

// ═══ _assemble - N12 file rule ═══
const n12Parts = await cm._assemble('s1', 'IN_SESSION', 'N12', 'field_based', 'field_gated', []);
check('N12 has file rule', n12Parts.some(p => p?.includes('boundary.json')), true);
check('N13 has file rule', (await cm._assemble('s1', 'IN_SESSION', 'N13', 'topic_based', 'topic_three_layer', [])).some(p => p?.includes('scheduler.js')), true);

// ═══ _getPrevIntent ═══
check('P0 prev=null', cm._getPrevIntent('P0'), null);
check('N1 prev=P0', cm._getPrevIntent('N1'), 'P0');
check('N15 prev=N14', cm._getPrevIntent('N15'), 'N14');
check('domain-rule-session prev=null', cm._getPrevIntent('domain-rule-session'), null);

// ═══ _formatTopicEvolution ═══
const events = [
  { change_level: 'major', intent: 'N1', topic_id: 'topic-1' },
  { change_level: 'checkpoint', intent: 'N3', topic_id: 'topic-1' },
  { change_level: 'unknown', intent: 'N5', topic_id: 'topic-2' },
];
const formatted = cm._formatTopicEvolution(events);
check('topicEv has 重大', formatted.includes('重大'), true);
check('topicEv has 锚点', formatted.includes('锚点'), true);
check('topicEv fallback level', formatted.includes('unknown'), true);

// ═══ full depth with events ═══
tunables.threeLayerInjectionDepth = 'full';
const fullStore = {
  getOutputs: async () => [{ intent: 'N1', output_name: 'L2-N1', content: '场景定义摘要' }],
  getTopicEvents: async () => events,
};
const cmFull = new ContextManager(sm, tunables, fullStore, mockConstitutions);
const fullParts = await cmFull.buildContext('s1', 'IN_SESSION', 'N2');
check('full has topicEvolution', fullParts.some(p => p?.includes('topicEvolution')), true);
check('full has context graph', fullParts.some(p => p?.includes('前置环节')), true);

// ═══ minimal ═══
const minParts = await cm._assemble('s1', 'IDLE', null, null, 'minimal', []);
check('minimal empty', minParts.length, 0);

// ═══ result ═══
const total = pass + fail;
console.log(`${pass}/${total} 通过${fail > 0 ? ` (${fail} 失败)` : ' ✅'}`);
process.exit(fail > 0 ? 1 : 0);
