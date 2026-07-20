// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 调度器状态机 — 富贵小安 v5.8 核心
 *
 * 10 状态 + TEMP_TOPIC(架构自动支持)
 *
 * @module fugui-xiaoan/state-machine-v5.8
 */

import { TurnType } from './turnType.js';
import { getTunable } from './tunables.js';
import { ContextManager } from './context-manager.js';
import { InMemoryContractStore } from './contract-store.js';
import { ToolRegistry } from './tool-registry.js';
import { META_COMMANDS } from './root-constitution.js';

// ═══ 10 状态 ═══════════════════════════════
const S = Object.freeze({
  IDLE:'idle', LISTENING:'listening', ANALYZING:'analyzing',
  IN_SESSION:'in_session', CLARIFYING:'clarifying',
  WAITING_CONFIRM:'waiting_confirm', EXECUTING:'executing', CLOSING:'closing',
  SLACK_NODE:'slack_node',
});

const VC = { amount:{min:0,max:999999,msg:'金额异常'}, time:{maxFuture:false,msg:'时间不能在未来'}, quantity:{min:0,max:10000,msg:'数量异常'} };

const KW = { record:{query:['查','查询'],delete:['删','删除'],compare:['比','对比']}, query:{record:['记','记账'],delete:['删']}, delete:{record:['记'],query:['查']}, compare:{record:['记'],query:['查'],delete:['删']} };

const PRETEND = ['好的我知道了','明白了','嗯嗯','好的好的','收到','没问题','您说得对','没错','好的给您','已为您'];

const SOFT_LANDING = { '推荐理财':'query', '闲聊':'other', '非记账问题':'other' };

// ═══ INTENT → RECOVERY ═══════════════════════
const RECOVERABLE = new Set(['record','query','delete','compare']);
const RECOVERY_KW = ['上次','继续','恢复','接着','之前那个'];

export class StateMachine {
  constructor({ llmClient, contractStore: cs, telemetry }) {
    this.llm = llmClient;
    this.cs = cs || new InMemoryContractStore();
    this.tools = new ToolRegistry(this.cs);
    this.cm = new ContextManager({ contractStore: this.cs });
    this.telemetry = telemetry;
    this._s = S.IDLE;
    this._last = null; this._lastId = null;
    this._pending = null;
    this._ses = { intent:null, taskType:null, hist:[], collected:{}, needed:[] };
    this._sesIdx = 0;
    this._n2Skip = true;
  }

  get state() { return this._s; }

  // ═══ 主入口 ═══════════════════════════════
  async handle(input) {
    const cmd = this._layer0(input);
    if (cmd) return this._doCommand(cmd);

    switch (this._s) {
      case S.IDLE: return this._idle(input);
      case S.LISTENING: return this._listen(input);
      case S.IN_SESSION: return this._inSession(input);
      case S.WAITING_CONFIRM: return this._confirm(input);
      case S.SLACK_NODE: return this._slack(input);
      case S.CLARIFYING: return this._clarify(input);
      default: return { msg:'系统忙', state:this._s };
    }
  }

  // ═══ 第0层: 口令 ═══════════════════════════
  _layer0(input) {
    const t = input.trim();
    for (const [cmd, cfg] of Object.entries(META_COMMANDS))
      if (cfg.patterns.some(p => t === p)) return { cmd, ...cfg };
    return null;
  }

  async _doCommand(cmd) {
    switch (cmd.cmd) {
      case 'wake': this._s = S.LISTENING; return { msg:'在呢！', state:this._s };
      case 'exit': this._s = S.IDLE; this._s3Archive(); return { msg:'再见！', state:this._s };
      case 'cancel': this._s = S.LISTENING; this._resetSession(); return { msg:'已取消。', state:this._s };
      case 'switch':
        // S3: 释放KV Cache + 归档 + roomStateIndex
        this._s3Archive();
        this._resetSession();
        this._s = S.LISTENING;
        return { msg:`已切换房间。当前活跃房间: ${this._getRoomIndex()}`, state:this._s };
    }
  }

  // ═══ S3 物理隔离 ═══════════════════════════
  _s3Archive() { this.cs._checkpoint && this.cs.saveCheckpoint(this._ses.intent, this._ses.collected); }
  _getRoomIndex() { return 'record(query/delete/compare均可用)'; }

  // ═══ idle ═════════════════════════════════
  async _idle(input) {
    const cmd = this._layer0(input);
    if (cmd?.cmd === 'wake') return this._doCommand(cmd);
    return { msg:'请先唤醒。', state:this._s };
  }

  // ═══ listening ═════════════════════════════
  async _listen(input) {
    const a = await this._analyze(input);

    // 软着陆路径
    for (const [topic, target] of Object.entries(SOFT_LANDING))
      if (input.includes(topic) && a.intent !== target) a.intent = target;

    // 第二分类维度
    if (a.intent === 'other' && a.inputNature === 'S') { this._s = S.SLACK_NODE; return { msg:'', state:this._s }; }
    if (a.intent === 'other' && a.inputNature === 'T') { return { msg:'这是临时主题房间，请描述你想做的事。(说"切断房间"回到记账)', state:this._s }; }

    // sessionCheckpoint 恢复
    if (a.fromCheckpoint && RECOVERABLE.has(a.intent)) {
      this._ses = { intent:a.intent, taskType:'field_based', collected:a.checkpoint?.stepSnapshots?.[a.intent]?.collectedFields || a.extracted || {}, hist:[], needed:[] };
      this._s = S.IN_SESSION;
      this._injectTools(a.intent);
      return { msg:`上次${a.intent==='record'?'记账':'查询'}进行到一半，继续吗？`, state:this._s };
    }

    this._ses = { intent:a.intent, taskType:'field_based', collected:a.extracted || {}, hist:[], needed:[] };
    this._s = S.IN_SESSION;
    this._injectTools(a.intent);
    return this._inSession(input);
  }

  async _analyze(input) {
    // checkpoint 恢复仅在用户明确表达续写意图时触发
    const cp = this.cs.getCheckpoint('default');
    const wantsRecovery = RECOVERY_KW.some(kw => input.includes(kw));
    if (cp && !cp.isExpired() && RECOVERABLE.has(cp.lastCompletedStep) && wantsRecovery)
      return { intent: cp.lastCompletedStep, fromCheckpoint: true, checkpoint: cp, extracted:{} };

    const resp = await this.llm?.analyze?.(input) || {};
    const { choice, logprobs } = resp;
    const prob = Math.exp(logprobs?.find(l => l.token === choice)?.logprob ?? -5) || 1;
    const map = { A:'record', B:'query', C:'delete', D:'compare', E:'other' };
    return { intent: prob >= 0.7 ? map[choice] : 'other', choice, probability:prob, extracted:resp.extracted || {}, inputNature:resp.inputNature || 'U' };
  }

  _injectTools(intent) {
    const { tools, catalog, metaTool } = this.tools.getToolsForIntent(intent);
    this._ses._tools = tools; this._ses._catalog = catalog; this._ses._metaTool = metaTool;
  }

  // ═══ in_session ════════════════════════════
  async _inSession(input) {
    const { intent, collected, hist, _tools, _metaTool } = this._ses;

    // DET 关键词扫描
    const kw = KW[intent];
    let suspicion = null;
    if (kw) for (const [t, ws] of Object.entries(kw)) if (ws.some(w => input.includes(w))) { suspicion = t; break; }

    const prompt = await this.cm.buildPromptContext({ contextGraph:{}, turnHistory:hist, currentAskField:this._ses._askField, currentTaskType:'field_based', currentStepName:intent, contractStore:this.cs, tunableParams:{} });
    const resp = await this.llm?.chat?.({ messages:[...prompt, { role:'user', content:input + (suspicion ? ` [offTaskSuspicion:${suspicion}]` : '') }], tools:[...(_tools||[]), _metaTool].filter(Boolean) }) || {};

    // v5.4 tool calling
    if (resp.tool_calls?.length) {
      const results = [];
      for (const tc of resp.tool_calls) {
        const args = JSON.parse(tc.function.arguments || '{}');
        const r = tc.function.name === 'search_tools' ? this.tools.searchTools(args.query) : await this.tools.executeTool(tc.function.name, args);
        results.push({ tool_call_id:tc.id, role:'tool', content:JSON.stringify(r) });
      }
      const resp2 = await this.llm?.chat?.({ messages:[...prompt,{role:'user',content:input},resp,...results], tools:[...(_tools||[]), _metaTool].filter(Boolean) }) || {};
      return this._processTurn(resp2);
    }
    return this._processTurn(resp);
  }

  _processTurn(resp) {
    const tt = resp.turnType || TurnType.REPLY;

    if (tt === TurnType.OFF_TASK) { this._pending = { ...this._ses.collected, intent:this._ses.intent }; this._s = S.LISTENING; return { msg:resp.message || '', state:this._s }; }
    if (tt === TurnType.GIVEUP) { this._s = S.LISTENING; return { msg:resp.message || '', state:this._s }; }
    if (tt === TurnType.VALIDATION_FAILED) { this._s = S.CLARIFYING; return { msg:resp.validationResult?.issue || '校验失败', state:this._s, _validationMsg:resp.message }; }

    if (tt === TurnType.COMPLETE) {
      const v = this._layer2_verify(resp.result || resp, this._ses.intent);
      if (!v.pass && !v.softIntercept) { this._s = S.CLARIFYING; return { msg:v.reason, state:this._s, _validationMsg:resp.message }; }
      if (v._logprobWarning) resp.result._logprobWarning = v._logprobWarning;

      // v5.4: query/compare 不经 EXECUTING
      if (['query','compare'].includes(this._ses.intent)) {
        this._s = S.LISTENING;
        return { msg:resp.result?._formatted || resp.message || JSON.stringify(resp.result), state:this._s };
      }
      // delete → WAITING_CONFIRM
      if (this._ses.intent === 'delete') { this._s = S.WAITING_CONFIRM; this._ses._del = resp.result; return { msg:`确认删除: ${resp.result?.category||''} ${resp.result?.amount||''}元?`, state:this._s }; }
      // record → EXECUTING
      if (this._ses.intent === 'record') {
        this.cs.insertRecord(resp.result); this._last = resp.result;
        // v5.7: 产出物确认后分段保留
        if (getTunable('conversation_segmentation_enabled', true))
          this.cs.archiveAndSummarize('default', [Math.max(0, this._ses.hist.length - 5), this._ses.hist.length], `完成记账: ${resp.result.category} ${resp.result.amount}元`, `output_${Date.now()}`, 'critical');
        this._s = S.LISTENING;
        return { msg:`已记录: ${resp.result.category} ${resp.result.amount}元`, state:this._s };
      }
      this._s = S.LISTENING;
      return { msg:resp.message || '', state:this._s };
    }

    if (resp.askingField) this._ses._askField = resp.askingField;
    this._ses.hist.push({ userInput:'', modelTurn:resp, turnType:tt, askingField:resp.askingField });
    return { msg:resp.message || '', state:this._s };
  }

  // ═══ 第3层: DET 四项检查 ═══════════════════
  _layer2_verify(result, intent) {
    if (!result || typeof result !== 'object') return { pass:false, reason:'L1结构校验失败' };

    if (intent === 'record') {
      const a = Number(result.amount);
      if (isNaN(a) || a <= 0 || a > VC.amount.max) return { pass:false, reason:VC.amount.msg };
    }

    const prob = result._probability ?? 1;
    if (prob < getTunable('logprobs_threshold', 0.4)) {
      const msg = (result.message || '');
      if (PRETEND.some(p => msg.includes(p))) {
        if (this._sesIdx < getTunable('cold_start_observation_window', 50)) {
          return { pass:true, softIntercept:true, _logprobWarning:`[提示: 模型概率较低(${prob.toFixed(2)})，请审查]` };
        }
        return { pass:false, reason:'logprobs过低,疑似硬撑式确认' };
      }
    }
    return { pass:true };
  }

  // ═══ confirm ══════════════════════════════
  async _confirm(input) {
    if (input === '确认' || input === '是') { this.cs.deleteRecord(this._ses._del?.recordId); this._s = S.LISTENING; return { msg:'已删除。', state:this._s }; }
    this._s = S.IN_SESSION; return { msg:'已取消删除。', state:this._s };
  }

  // ═══ slack ════════════════════════════════
  async _slack(input) {
    const cmd = this._layer0(input);
    if (cmd?.cmd === 'switch' || cmd?.cmd === 'exit') return this._doCommand(cmd);
    const a = await this._analyze(input);
    if (a.intent !== 'other' && a.intent !== 'other') { this._s = S.LISTENING; return this._listen(input); }
    return { msg:'嗯嗯。', state:this._s };
  }

  // ═══ clarify ═════════════════════════════
  async _clarify(input) {
    this._s = S.IN_SESSION; return this._inSession(input);
  }

  _resetSession() { this._ses = { intent:null, taskType:null, hist:[], collected:{}, needed:[] }; }
}
