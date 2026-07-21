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
  constructor(stateMachine, routeTable, adapter, contextManager, toolRegistry, contractStore, outputsManager, telemetry, tunables, l3Path, outputDir) {
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
    this._outputDir = outputDir || null;

    // 运行时上下文
    /** @type {string|null} 当前会话ID */
    this._sessionId = null;
    /** @type {number} 对话轮次（user=N, assistant=N+1） */
    this._turnIndex = 0;
    /** @type {string|null} N2 角色一产出物（供角色二使用） */
    this._n2Role1Output = null;
    /** @type {{role1Output:string,n1Boundary:string}|null} N2 角色二上下文 */
    this._n2Role2Context = null;
    /** @type {string|null} topicEvolution 主题ID（topic_based 首次触发时初始化） */
    this._topicId = null;
  }

  /** 初始化会话 */
  async initSession(sessionId) {
    this._sessionId = sessionId;
    this._turnIndex = 0;

    // DET 项目选择——不走 LLM
    const projects = this._store.listProjects();
    if (projects.length === 0) {
      this._sm.transition(STATES.IDLE);
      return {
        phase: 'project_create',
        message: '欢迎！请给你的项目起个名字（例如"记账助手"）：',
        projects: []
      };
    }
    // 有项目→直接列出，用户选一个
    this._sm.transition(STATES.IDLE);
    const lastProj = this._store.getLastProject();
    return {
      phase: 'project_list',
      message: `已有项目：\n${projects.map((p,i) => `  ${i+1}. ${p.projectName}${p.projectId === lastProj ? ' ←上次' : ''}`).join('\n')}\n\n输入编号或项目名选择：`,
      projects: projects.map((p,i) => ({ id: p.projectId, name: p.projectName, index: i+1 })),
    };
  }

  /** DET 处理项目选择 */
  async handleProjectSelect(input) {
    const projects = this._store.listProjects();
    const t = input.trim();

    // 数字 → 按序号匹配
    const n = parseInt(t);
    if (n >= 1 && n <= projects.length) {
      const p = projects[n-1];
      return { phase: 'ready', projectId: p.projectId, projectName: p.projectName };
    }

    // 名称匹配
    const matched = projects.find(p => p.projectName === t || p.projectId === t);
    if (matched) {
      return { phase: 'ready', projectId: matched.projectId, projectName: matched.projectName };
    }

    // 没匹配 → 当成新项目名
    return { phase: 'ready', projectId: t.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_'), projectName: t, isNew: true };
  }

  /** 项目选定后，完成会话初始化 */
  async finishInitSession(projectId) {
    this._projectId = projectId || this._projectId || 'default';

    // 检查是否有历史会话——断点续接
    const lastSession = this._store.getLastActiveSession();
    if (lastSession) {
      const lastIntent = lastSession.current_intent || 'P0';
      const lastState = lastSession.state || 'ANALYZING';
      await this._store.createSession(this._sessionId, { ...this._tunables, resumedFrom: lastSession.session_id });
      this._sm.transition(STATES.ANALYZING);
      this._sm._intent = lastIntent;
      this._sm._taskType = lastSession.task_type || 'topic_based';
      console.log(`[scheduler] 续接会话 ${lastSession.session_id} → ${lastIntent}`);
      return { state: STATES.ANALYZING, message: `续接上次设计 (${lastIntent})。输入你的想法，或说"重新开始"回到 P0。` };
    }

    await this._store.createSession(this._sessionId, { ...this._tunables });
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
        // 低置信度 → 看进度，做建议
        const progress = await this._getProgress();
        let hint;
        if (!progress.next) {
          hint = '全部节点已完成。你是想修改某个节点的设计，还是开始新的设计？';
        } else if (progress.done.length === 0) {
          hint = '我们还没开始。你想设计一个什么样的智能体？';
        } else {
          hint = `你已完成 ${progress.done.join('→')}，接下来是 ${progress.next}。要继续吗？`;
        }
        this._telemetry.endTrace(trace, 'low_confidence');
        return { state: this._sm.fullState, turnType: 'ask', content: hint };
      }
      // 正常路由到对应 IN_SESSION
      const taskType = this._sm.getTaskType(intent);
      this._sm.transition(STATES.IN_SESSION, intent, taskType);

      await this._store.updateSessionState(this._sessionId, STATES.IN_SESSION, intent);
      this._telemetry.recordTransition('ANALYZING', this._sm.fullState);

      // 初始化 topicId（topic_based 意图）——优先从历史恢复，支持跨会话关联
      if (!this._topicId && this._sm.taskType === 'topic_based' && intent !== 'other') {
        // 查最近一次同 intent 的 topicId
        const recent = await this._store.getTopicHistoryByIntent(this._sessionId, intent);
        if (recent?.topic_id) {
          this._topicId = recent.topic_id;
        } else {
          this._topicId = `${intent}-${Date.now()}`;
        }
      }

      // ═══ Layer 2: IN_SESSION - 三层注入 + tool calling 循环 ═══
      const contextParts = await this._cm.buildContext(this._sessionId, STATES.IN_SESSION, intent, []);
      const systemPrompt = contextParts.join('\n\n---\n\n');

      const tools = this._tools.getToolDefinitions(intent);
      const modelOverride = this._rt.getSecondLayerOverride(intent);

      const conversationMessages = [{ role: 'user', content: userInput }];
      let parsed;
      const MAX_TOOL_ROUNDS = 3;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let rawResult;
        if (intent === 'N2') {
          rawResult = await this._runN2DualRole(systemPrompt, userInput, trace);
          parsed = this._adapter.parseInSessionResult(rawResult);
          break;  // N2 双角色不走 tool calling 循环
        } else if (intent === 'N13') {
          rawResult = await this._adapter.callCodeModel(systemPrompt, conversationMessages, tools);
        } else {
          rawResult = await this._adapter.callInSession(systemPrompt, conversationMessages, tools, modelOverride || undefined);
        }
        parsed = this._adapter.parseInSessionResult(rawResult);

        // 无工具调用 → 模型已完成回答
        if (parsed.toolCalls.length === 0) break;

        // 执行工具并将结果追加到对话
        conversationMessages.push({ role: 'assistant', content: parsed.content || '', tool_calls: parsed.toolCalls });
        for (const tc of parsed.toolCalls) {
          try {
            const toolResult = await this._executeTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
            this._telemetry.logEvent(trace, 'tool_called', { tool: tc.function.name, round });
            conversationMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            });
          } catch (err) {
            this._telemetry.logEvent(trace, 'tool_error', { tool: tc.function.name, error: err.message });
            conversationMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }
      }
      this._telemetry.logEvent(trace, 'in_session_done', { turnType: parsed.turnType });

      // 记录对话日志（每轮 user + assistant 各占一个整数 turnIndex）
      await this._store.appendConversation(this._sessionId, this._turnIndex, 'user', userInput, parsed.turnType);
      this._turnIndex++;
      await this._store.appendConversation(this._sessionId, this._turnIndex, 'assistant', parsed.content, parsed.turnType);

      // ═══ Layer 3: DET 四项校验 ═══
      const detResult = this._detValidate(intent, parsed);
      if (!detResult.valid) {
        this._sm.transition(STATES.CLARIFYING, intent, this._sm.taskType);
        this._telemetry.logEvent(trace, 'det_reject', detResult);
        this._telemetry.endTrace(trace, 'clarifying');
        return { state: this._sm.fullState, turnType: 'validation_failed', content: detResult.message };
      }

      // ═══ v5.8 强制落盘：模型漏调 writeOutput 时调度器兜底 ═══
      if (parsed.content && parsed.content.length > 10 && parsed.toolCalls.length === 0) {
        await this._store.writeOutput(
          this._sessionId, intent,
          `L2-${intent}-v5.8`, this._outputs.importanceOf(intent), parsed.content
        );
        this._telemetry.inc('criticalOutputsWritten');
      }

      // ═══ 路由 ═══
      // turnType 为 null 且模型已产出内容 → 默认 reply（等待后续输入）
      const effectiveTurnType = parsed.turnType || (parsed.content?.length > 10 ? 'reply' : null);
      const routeKey = effectiveTurnType === 'complete'
        ? `turnType=complete`
        : effectiveTurnType === 'off-task'
          ? `turnType=off-task`
          : effectiveTurnType === 'giveup'
            ? `turnType=giveup`
            : effectiveTurnType === 'reply'
              ? `intent=${intent}`
              : `intent=${intent}`;

      const route = this._rt.match(this._sm.fullState, routeKey);
      if (route) {
        // 处理 topicEvolution
        if (route.topicEvolutionEventAppended) {
          const changeLevel = effectiveTurnType === 'complete' ? 'checkpoint'
            : effectiveTurnType === 'off-task' ? 'active'
            : effectiveTurnType === 'giveup' ? 'abandoned' : 'minor';
          await this._store.appendTopicEvent(this._sessionId, this._topicId || `${intent}-${Date.now()}`, intent, changeLevel);
        }

        // 写产出物
        if (parsed.turnType === 'complete') {
          await this._writeCriticalOutput(intent, parsed.content);
        }

        const nextIntent = [STATES.IN_SESSION, STATES.ANALYZING].includes(route.to) ? intent : null;
        this._sm.transition(route.to, nextIntent);
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

  /** 获取设计进度——哪些节点已完成 */
  async _getProgress() {
    const outputs = await this._store.getOutputs(this._sessionId);
    const completed = new Set(outputs.map(o => o.intent));
    const nodeOrder = ['P0','N1','N2','N3','N4','N5','N6','N7','N8','N9','N10','N11','N12','N13','N14','N15'];
    const done = [];
    let next = null;
    for (const n of nodeOrder) {
      if (completed.has(n)) { done.push(n); }
      else { next = n; break; }
    }
    return { done, next };
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
        // S3四步：① 标记当前房间产出物边界 ② KV Cache释放 ③ roomStateIndex注入 ④ ANALYZING重新识别
        await this._store.appendSegmentBoundary(this._sessionId, this._sm.currentIntent);
        this._sm.transition(STATES.ANALYZING);
        await this._store.updateSessionState(this._sessionId, STATES.ANALYZING);
        this._telemetry.logEvent(trace, 's3_switch', { roomStateIndex: this._sm.intentList });
        return { state: STATES.ANALYZING, turnType: 'reply', content: '房间已切换，请选择新的节点（P0/N1~N15）。' };
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
      return { intent: 'P0', letter: 'A', probability: 0 };
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
      outputDir: this._outputDir,
      scheduler: this,           // v5.8 P0修复: 工具需写入 scheduler 字段
    };
    return this._tools.execute(name, args, ctx);
  }

  // === N2 双角色串行+信息隔离 ===
  async _runN2DualRole(systemPrompt, userInput, trace) {
    this._telemetry.logEvent(trace, 'n2_dual_role_start');

    // 角色一：只注场景定义（systemPrompt中已含N1环节宪法）
    const role1Result = await this._adapter.callInSession(
      `${systemPrompt}

[角色一] 你只负责生成边界紧张度测试语料。基于N1定义的场景和意图清单，生成20-30条边界语料。每条语料应测试意图边界的不同维度。`,
      [{ role: 'user', content: userInput }],
      [],
      null
    );
    const role1Parsed = this._adapter.parseInSessionResult(role1Result);
    this._n2Role1Output = role1Parsed.content;
    this._telemetry.logEvent(trace, 'n2_role1_done', { length: role1Parsed.content.length });

    // 角色二：注角色一输出+N1边界+**N2环节宪法**，信息隔离
    const n2Constitution = this._cm._loadConstitution('N2');
    const role2Result = await this._adapter.callInSession(
      `${n2Constitution}

[角色二] 你负责审查角色一生成的语料。上述N2环节宪法是你的行为约束，必须严格遵守。审查标准：
1. 每条语料是否在N1定义的意图边界内？
2. 是否覆盖了所有意图的边界情况？
3. 语料是否有歧义或无法判定？

角色一输出：
${role1Parsed.content.slice(0, getTunable(this._tunables, 'maxContextTokens') / 2)}

请逐条审查，标注通过/边界模糊/越界/缺失维度。最后给出综合评定。`,
      [{ role: 'user', content: '请审查以上语料。' }],
      [],
      null
    );

    this._telemetry.logEvent(trace, 'n2_dual_role_done');
    return role2Result;
  }

  // === DET 校验 ===
  _detValidate(intent, parsed) {
    const taskType = this._sm.getTaskType(intent);

    if (taskType === 'field_based') {
      // Layer 3-A: value_domain 校验（从 L3 dataProtocol 读取，避免硬编码 N11/N12）
      let rules = null;
      try {
        const dp = JSON.parse(readFileSync(join(this._l3Path, 'dataProtocol.json'), 'utf-8'));
        rules = dp?.fieldValidation?.[intent];
      } catch { /* dataProtocol 缺失时跳过 */ }

      if (rules) {
        // 通用 field_based 校验：validateField 工具的逻辑移入
        const matched = rules.validValues?.some(v => parsed.content.includes(v))
                    || (rules.pattern && new RegExp(rules.pattern).test(parsed.content));
        if (!matched && parsed.turnType === 'complete') {
          return { valid: false, message: rules.failMessage || `${intent} 输出不符合校验规则` };
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
