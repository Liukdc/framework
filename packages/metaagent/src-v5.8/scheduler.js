// @MetaAgent v5.8 — scheduler.js
// 五层过滤调度器：M1口令→ANALYZING→IN_SESSION→DET→路由

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATES } from './state-machine.js';
import { getTunable } from './tunables.js';
import { quickValidate } from './l2-l3-validator.js';

// M1 元指令集硬匹配
const M1_PATTERNS = {
  wake:   ['元智能体'],
  exit:   ['退出'],
  cancel: ['取消'],
  switch: ['切断房间'],
};

export class Scheduler {
  constructor(stateMachine, routeTable, adapter, contextManager, toolRegistry, contractStore, outputsManager, telemetry, tunables, l3Path) {
    this._sm = stateMachine;
    this._rt = routeTable;
    this._adapter = adapter;
    this._cm = contextManager;
    this._tools = toolRegistry;
    this._store = contractStore;
    this._outputs = outputsManager;
    this._telemetry = telemetry;
    this._tunables = tunables;
    this._l3Path = l3Path;

    // 运行时上下文
    this._sessionId = null;
    this._turnIndex = 0;
    this._n2Role1Output = null;
    this._topicId = null;
  }

  /** 初始化会话 */
  async initSession(sessionId) {
    this._sessionId = sessionId;
    this._turnIndex = 0;

    // L2-L3 一致性校验（冷启动）
    const { allPass, results } = await quickValidate(this._l3Path);
    if (!allPass) {
      console.warn('[scheduler] L2-L3 校验不通过:', results.filter(r => !r.pass).map(r => r.check));
    }

    await this._store.createSession(sessionId, { ...this._tunables });
    this._sm.transition(STATES.IDLE);
    this._telemetry.inc('totalSessions');

    return { state: STATES.IDLE, message: '元智能体已就绪。说出你的智能体设计想法，我们从 P0 开始。' };
  }

  /** 处理一轮用户输入 */
  async handleTurn(userInput) {
    this._turnIndex++;
    this._telemetry.inc('totalTurns');
    const trace = this._telemetry.startTrace('handleTurn', { input: userInput.slice(0, 50) });

    try {
      // ═══ Layer 0: M1 元指令 - EXACT_MATCH ═══
      const m1Result = this._checkM1(userInput);
      if (m1Result) {
        this._telemetry.logEvent(trace, 'm1_match', m1Result);
        return await this._handleM1(m1Result, trace);
      }

      // ═══ Layer 0.5: topic_based 不执行关键词扫描 ═══
      // (topic_based 无跨任务概念，跳过关键词扫描)

      // ═══ Layer 1: ANALYZING - 强制选择+logprobs ═══
      const analyzingResult = await this._analyzeIntent(userInput, trace);
      if (!analyzingResult) {
        this._telemetry.endTrace(trace, 'error');
        return { state: this._sm.fullState, turnType: 'giveup', content: '无法识别意图，请重新描述。' };
      }

      const { intent, letter, probability } = analyzingResult;
      this._telemetry.recordIntent(intent);
      this._telemetry.logEvent(trace, 'analyzing_done', { intent, probability });

      // logprobs 阈值裁决
      const threshold = getTunable(this._tunables, 'logprobsThreshold');
      if (probability < threshold) {
        // 低置信度 → intent=other
        this._sm.transition(STATES.IN_SESSION, 'other', 'topic_based');
      } else {
        // 路由到对应 IN_SESSION
        const taskType = this._sm.getTaskType(intent);
        this._sm.transition(STATES.IN_SESSION, intent, taskType);
      }

      await this._store.updateSessionState(this._sessionId, STATES.IN_SESSION, intent);
      this._telemetry.recordTransition('ANALYZING', this._sm.fullState);

      // ═══ Layer 2: IN_SESSION - 三层注入 + tool calling ═══
      const contextParts = await this._cm.buildContext(this._sessionId, STATES.IN_SESSION, intent, []);
      const systemPrompt = contextParts.join('\n\n---\n\n');

      const tools = this._tools.getToolDefinitions(intent);
      const modelOverride = this._rt.getSecondLayerOverride(intent);

      const inSessionResult = await this._adapter.callInSession(systemPrompt, [
        { role: 'user', content: userInput },
      ], tools, modelOverride || undefined);

      const parsed = this._adapter.parseInSessionResult(inSessionResult);
      this._telemetry.logEvent(trace, 'in_session_done', { turnType: parsed.turnType });

      // 如果 LLM 调用了工具，执行工具
      if (parsed.toolCalls.length > 0) {
        for (const tc of parsed.toolCalls) {
          try {
            const toolResult = await this._executeTool(tc.function.name, JSON.parse(tc.function.arguments));
            this._telemetry.logEvent(trace, 'tool_called', { tool: tc.function.name });
          } catch (err) {
            this._telemetry.logEvent(trace, 'tool_error', { tool: tc.function.name, error: err.message });
          }
        }
      }

      // 记录对话日志
      await this._store.appendConversation(this._sessionId, this._turnIndex, 'user', userInput, parsed.turnType);
      await this._store.appendConversation(this._sessionId, this._turnIndex + 0.5, 'assistant', parsed.content, parsed.turnType);

      // ═══ Layer 3: DET 四项校验 ═══
      const detResult = this._detValidate(intent, parsed);
      if (!detResult.valid) {
        this._sm.transition(STATES.CLARIFYING, intent, this._sm.taskType);
        this._telemetry.logEvent(trace, 'det_reject', detResult);
        this._telemetry.endTrace(trace, 'clarifying');
        return { state: this._sm.fullState, turnType: 'validation_failed', content: detResult.message };
      }

      // ═══ 路由 ═══
      const routeKey = parsed.turnType === 'complete'
        ? `turnType=complete`
        : parsed.turnType === 'off-task'
          ? `turnType=off-task`
          : parsed.turnType === 'giveup'
            ? `turnType=giveup`
            : `intent=${intent}`;

      const route = this._rt.match(this._sm.fullState, routeKey);
      if (route) {
        // 处理 topicEvolution
        if (route.topicEvolutionEventAppended) {
          const changeLevel = parsed.turnType === 'complete' ? 'checkpoint'
            : parsed.turnType === 'off-task' ? 'active'
            : parsed.turnType === 'giveup' ? 'abandoned' : 'minor';
          await this._store.appendTopicEvent(this._sessionId, this._topicId || `${intent}-${Date.now()}`, intent, changeLevel);
        }

        // 写产出物
        if (parsed.turnType === 'complete') {
          await this._writeCriticalOutput(intent, parsed.content);
        }

        this._sm.transition(route.to, route.to === STATES.ANALYZING ? null : intent);
        await this._store.updateSessionState(this._sessionId, this._sm.state, intent);
        this._telemetry.recordTransition(STATES.IN_SESSION, route.to);
      }

      this._telemetry.endTrace(trace, 'ok');
      return {
        state: this._sm.fullState,
        turnType: parsed.turnType,
        content: parsed.content,
        intent,
        probability,
      };

    } catch (err) {
      this._telemetry.inc('errors');
      this._telemetry.logEvent(trace, 'error', { message: err.message });
      this._telemetry.endTrace(trace, 'error');
      throw err;
    }
  }

  // === M1 元指令处理 ===
  _checkM1(input) {
    const trimmed = input.trim();
    for (const [cmd, patterns] of Object.entries(M1_PATTERNS)) {
      for (const p of patterns) {
        if (trimmed === p) return { type: cmd, input };
      }
    }
    return null;
  }

  async _handleM1(m1Result, trace) {
    switch (m1Result.type) {
      case 'wake': {
        this._sm.transition(STATES.LISTENING);
        await this._store.updateSessionState(this._sessionId, STATES.LISTENING);
        return { state: STATES.LISTENING, turnType: 'reply', content: '元智能体已唤醒。请描述你要设计的智能体。' };
      }
      case 'exit': {
        await this._store.updateSessionState(this._sessionId, STATES.CLOSING);
        this._sm.transition(STATES.CLOSING);
        this._telemetry.endTrace(trace, 'exit');
        return { state: STATES.CLOSING, turnType: 'reply', content: '会话结束，产出物已归档。' };
      }
      case 'cancel': {
        await this._store.updateSessionState(this._sessionId, STATES.LISTENING);
        this._sm.transition(STATES.LISTENING);
        this._telemetry.logEvent(trace, 'cancel');
        return { state: STATES.LISTENING, turnType: 'reply', content: '当前操作已取消。' };
      }
      case 'switch': {
        // S3: KV Cache 释放 + roomStateIndex 注入
        this._sm.transition(STATES.ANALYZING);
        await this._store.updateSessionState(this._sessionId, STATES.ANALYZING);
        this._telemetry.logEvent(trace, 's3_switch');
        return { state: STATES.ANALYZING, turnType: 'reply', content: '房间已切换，请选择新的节点。' };
      }
      default:
        return null;
    }
  }

  // === ANALYZING ===
  async _analyzeIntent(userInput, trace) {
    const boundaryRaw = JSON.parse(readFileSync(join(this._l3Path, 'boundary.json'), 'utf-8'));
    const params = this._adapter.buildAnalyzingPrompt(userInput, boundaryRaw.doList);

    const result = await this._adapter._call(params);
    const { letter, probability } = this._adapter.parseAnalyzingResult(result);

    if (!letter) return null;

    const idx = letter.charCodeAt(0) - 65;
    if (idx < 0 || idx >= boundaryRaw.doList.length) {
      // 超出范围 → other
      return { intent: 'other', letter, probability: 0 };
    }

    const intent = boundaryRaw.doList[idx].intent;
    return { intent, letter, probability };
  }

  // === 工具执行 ===
  async _executeTool(name, args) {
    const ctx = {
      sessionId: this._sessionId,
      contractStore: this._store,
      importanceOf: (i) => this._outputs.importanceOf(i),
      getConstitution: (i) => this._cm._loadConstitution(i),
      _n2Role1Output: this._n2Role1Output,
    };
    return this._tools.execute(name, args, ctx);
  }

  // === DET 校验 ===
  _detValidate(intent, parsed) {
    const taskType = this._sm.getTaskType(intent);

    if (taskType === 'field_based') {
      // Layer 3-A: value_domain 校验
      if (intent === 'N11' && parsed.turnType === 'complete') {
        if (!['pass', 'fail', 'partial'].some(v => parsed.content.includes(v))) {
          return { valid: false, message: 'N11 只能输出 pass / fail / partial。请修正。' };
        }
      }
      if (intent === 'N12' && parsed.turnType === 'complete') {
        if (!parsed.content.match(/v?\d+\.\d+/)) {
          return { valid: false, message: 'N12 只能输出版本号 (如 v5.8)。' };
        }
      }
    } else if (taskType === 'topic_based') {
      // Layer 3-B: output_format 校验
      if (!parsed.content || parsed.content.trim().length === 0) {
        return { valid: false, message: '输出为空，请重新生成。' };
      }
    }

    return { valid: true };
  }

  // === 关键产出物写盘 ===
  async _writeCriticalOutput(intent, content) {
    if (!this._outputs.isCritical(intent)) return;

    try {
      await this._store.writeOutput(this._sessionId, intent, this._outputs.outputName(intent), 'critical', content);
      this._telemetry.inc('criticalOutputsWritten');
    } catch (err) {
      this._telemetry.inc('criticalOutputsFailed');
      console.error(`[scheduler] critical 产出物写盘失败: ${intent}`, err.message);
    }
  }

  /** 获取当前状态 */
  get state() { return this._sm.state; }
  get fullState() { return this._sm.fullState; }
}
