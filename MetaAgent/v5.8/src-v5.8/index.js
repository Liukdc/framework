// @MetaAgent v5.8 — index.js
// 主入口：MetaAgent 类，将调度器/上下文管理器/宪法/工具/存储/适配器组装为可运行实例

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StateMachine } from './state-machine.js';
import { RouteTable } from './route-table.js';
import { Scheduler } from './scheduler.js';
import { ContextManager } from './context-manager.js';
import { DeepSeekAdapter } from './deepseek-adapter.js';
import { ToolRegistry } from './tool-registry.js';
import { ContractStore } from './contract-store.js';
import { OutputsManager } from './outputs-manager.js';
import { Telemetry } from './telemetry.js';
import { createDefaultTunables, validateTunables, getTunable } from './tunables.js';
import { quickValidate } from './l2-l3-validator.js';
import { loadAllConstitutions, getConstitutionForIntent } from './constitutions/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 默认 L3 配置路径（整合到项目内） */
const DEFAULT_L3_PATH = join(__dirname, '..', 'l3-v5.8');

/** 默认数据库路径 */
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'metaagent.db');

export class MetaAgent {
  /**
   * @param {object} options
   * @param {string} [options.l3Path]   L3 生成包路径
   * @param {string} [options.dbPath]   数据库路径
   * @param {object} [options.tunables] 参数覆盖（不传则用默认值）
   * @param {string} [options.apiKey]   DeepSeek API Key（优先于环境变量）
   */
  constructor(options = {}) {
    this._l3Path = options.l3Path || DEFAULT_L3_PATH;
    this._dbPath = options.dbPath || DEFAULT_DB_PATH;
    this._outputDir = options.outputDir || null;

    // 参数
    const base = createDefaultTunables();
    const merged = { ...base, ...(options.tunables || {}) };
    const { valid, conflicts, params } = validateTunables(merged);
    if (conflicts.length > 0) {
      console.warn('[MetaAgent] tunable conflicts:', conflicts);
    }
    this._tunables = params;

    // 初始化各模块（顺序依赖）
    this._stateMachine = new StateMachine(this._l3Path);
    this._routeTable = new RouteTable(this._l3Path, this._stateMachine);
    this._toolRegistry = new ToolRegistry(this._l3Path);
    this._outputsManager = new OutputsManager(this._l3Path);
    this._store = new ContractStore(this._dbPath, this._tunables);

    // 加载 L3 boundary 供 adapter 生成 ANALYZING prompt 语义标签
    let doList = [];
    try {
      doList = JSON.parse(readFileSync(join(this._l3Path, 'boundary.json'), 'utf-8')).doList;
    } catch { /* boundary.json 可能由 N12 逐步生成 */ }
    this._adapter = new DeepSeekAdapter(this._tunables, options.apiKey || null, doList);
    this._telemetry = new Telemetry();
    this._constitutions = null;
    this._contextManager = null;
    this._scheduler = null;

    this._initialized = false;
    this._sessionId = null;
  }

  /** 初始化：打开数据库、加载宪法、创建调度器 */
  async init() {
    await this._store.open();

    // 加载宪法
    this._constitutions = loadAllConstitutions(this._l3Path);

    // 创建上下文管理器
    this._contextManager = new ContextManager(
      this._stateMachine,
      this._tunables,
      this._store,
      this._constitutions,
    );

    // 创建调度器
    this._scheduler = new Scheduler(
      this._stateMachine,
      this._routeTable,
      this._adapter,
      this._contextManager,
      this._toolRegistry,
      this._store,
      this._outputsManager,
      this._telemetry,
      this._tunables,
      this._l3Path,
      this._outputDir,
    );

    this._initialized = true;
    return this;
  }

  /** 确保已初始化 */
  _ensureInit() {
    if (!this._initialized) throw new Error('MetaAgent 尚未初始化，请先调用 init()');
  }

  /** 启动新会话 */
  async startSession(sessionId) {
    this._ensureInit();
    this._sessionId = sessionId || `session-${Date.now()}`;
    return this._scheduler.initSession(this._sessionId);
  }

  /** 发送用户消息 */
  async sendMessage(input) {
    this._ensureInit();
    if (!this._sessionId) throw new Error('请先调用 startSession()');
    return this._scheduler.handleTurn(input);
  }

  /** 获取当前状态 */
  get state() {
    return this._stateMachine ? this._stateMachine.state : 'IDLE';
  }

  /** 获取完整状态（含 intent） */
  get fullState() {
    return this._stateMachine ? this._stateMachine.fullState : 'IDLE';
  }

  /** 获取当前 intent */
  get currentIntent() {
    return this._stateMachine ? this._stateMachine.currentIntent : null;
  }

  /** 获取 telemetry 快照 */
  getMetrics() {
    return this._telemetry ? this._telemetry.snapshot() : {};
  }

  /** 获取会话历史 */
  async getSessionHistory() {
    this._ensureInit();
    if (!this._sessionId) throw new Error('请先调用 startSession()');
    return this._store.getConversationHistory(this._sessionId);
  }

  /** 获取产出物列表 */
  async getOutputs() {
    this._ensureInit();
    if (!this._sessionId) throw new Error('请先调用 startSession()');
    return this._store.getOutputs(this._sessionId);
  }

  /** 获取 topicEvolution 历史 */
  async getTopicHistory() {
    this._ensureInit();
    if (!this._sessionId) throw new Error('请先调用 startSession()');
    return this._store.getTopicEvents(this._sessionId);
  }

  /** 全文搜索 */
  async search(query) {
    this._ensureInit();
    return this._store.searchConversations(query);
  }

  /** L2-L3 一致性校验 */
  async validate() {
    return quickValidate(this._l3Path);
  }

  /** 销毁：关闭数据库 */
  async destroy() {
    if (this._store) {
      this._store.close();
    }
    this._initialized = false;
  }
}

/**
 * SDK 工厂：一句创建，给出 L3 配置包即可跑
 * @example
 *   import { createAgent } from '@exomind/metaagent';
 *   const agent = await createAgent({ l3Path: './my-agent/', apiKey: 'sk-xxx' });
 *   const resp = await agent.sendMessage('帮我记一笔账');
 */
export async function createAgent(options = {}) {
  const agent = new MetaAgent(options);
  await agent.init();
  return agent;
}

// === CLI 模式 ===
async function cli() {
  const args = process.argv.slice(2);

  // 单轮模式: node index.js "用户输入"
  if (args.length > 0) {
    await singleTurn(args[0]);
    return;
  }

  // 交互模式: node index.js（无参数）
  await interactiveMode();
}

/** 单轮对话 */
async function singleTurn(input) {
  const meta = new MetaAgent();
  await meta.init();
  console.log('[MetaAgent v5.8 CLI]');

  const initResp = await meta.startSession('cli-session');
  console.log(`[${initResp.state}] ${initResp.message}`);

  const resp = await meta.sendMessage(input);
  console.log(`\n[${resp.state}] intent=${resp.intent} prob=${resp.probability?.toFixed(3)}`);
  console.log(`[${resp.turnType}] ${resp.content?.slice(0, 500)}`);

  console.log('\n--- metrics ---');
  console.log(JSON.stringify(meta.getMetrics(), null, 2));
  await meta.destroy();
}

/** 多轮交互模式 */
async function interactiveMode() {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n> ',
  });

  const meta = new MetaAgent();
  await meta.init();

  const sessionId = `interactive-${Date.now()}`;
  const initResp = await meta.startSession(sessionId);

  console.log('══════════════════════════════════════════');
  console.log('  MetaAgent v5.8 — 交互模式');
  console.log('  命令: /exit 退出 | /state 查看状态 | /metrics 查看指标');
  console.log('══════════════════════════════════════════');
  console.log(`\n[${initResp.state}] ${initResp.message}`);
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === '/exit') {
      console.log('会话结束。');
      rl.close();
      return;
    }

    if (input === '/state') {
      console.log(`  状态: ${meta.fullState} | intent: ${meta.currentIntent || 'none'}`);
      rl.prompt();
      return;
    }

    if (input === '/metrics') {
      console.log('  metrics:', JSON.stringify(meta.getMetrics(), null, 2));
      rl.prompt();
      return;
    }

    try {
      const resp = await meta.sendMessage(input);
      console.log(`\n━━━ [${resp.state}] intent=${resp.intent} prob=${resp.probability?.toFixed(3)} turnType=${resp.turnType} ━━━`);
      console.log(resp.content);
    } catch (err) {
      console.error(`\n❌ 错误: ${err.message}`);
    }
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\n--- metrics ---');
    console.log(JSON.stringify(meta.getMetrics(), null, 2));
    await meta.destroy();
    process.exit(0);
  });
}

// 仅当直接运行时启用 CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
