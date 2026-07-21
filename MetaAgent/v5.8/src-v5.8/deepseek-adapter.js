// @MetaAgent v5.8 — deepseek-adapter.js
// DeepSeek API 适配器：ANALYZING 强制选择+logprobs、IN_SESSION 通用对话、N13 代码专项

import { getTunable } from './tunables.js';

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

export class DeepSeekAdapter {
  /**
   * @param {object} tunables - 可调参数
   * @param {string} [apiKey] - DeepSeek API Key
   * @param {object[]} [doList] - L3 boundary.doList，用于 _describeIntent 生成语义标签
   */
  constructor(tunables, apiKey, doList) {
    this._tunables = tunables;
    this._apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this._doList = doList || null;
    if (!this._apiKey) console.warn('[DeepSeekAdapter] API Key 未设置（无 DEEPSEEK_API_KEY 环境变量且未传入 apiKey），API 调用将失败');
  }

  // === ANALYZING: 强制选择 + logprobs ===

  /** 构造 ANALYZING 的强制选择 prompt */
  buildAnalyzingPrompt(userInput, doList) {
    const options = doList.map((item, i) => {
      const letter = String.fromCharCode(65 + i); // A, B, C...
      return `${letter}. ${item.intent}: ${this._describeIntent(item.intent)}`;
    }).join('\n');

    return {
      model: getTunable(this._tunables, 'analyzingModel'),
      messages: [
        {
          role: 'system',
          content: `你是意图识别器。用户输入是智能体设计流程中的一句话，你必须从以下选项中选出最匹配的意图。只输出字母。\n\n可选意图：\n${options}\n\n规则：\n- 用户要"开始设计"/"帮我设计一个XX智能体"→ P0\n- 用户要"继续上次"/"回到之前"→ 匹配 topicEvolution 历史\n- 用户要切换话题→ other\n- 用户输入"退出"/"取消"/"切断房间"→ other（由DET处理M1口令）`,
        },
        { role: 'user', content: userInput },
      ],
      temperature: getTunable(this._tunables, 'temperatureAnalyzing'),
      max_tokens: 128,          // v4: reasoning 消耗 token，需留足余量
      logprobs: true,
      top_logprobs: 5,
    };
  }

  /** 调用 DeepSeek API */
  async _call(params) {
    const url = `${DEEPSEEK_BASE_URL}/chat/completions`;

    // DEBUG: 检查 tools 参数传递
    const hasTools = params.tools?.length > 0;
    if (hasTools && process.env.DEBUG_TOOLS) {
      console.error('[DEBUG TOOLS] sending', params.tools.length, 'tools:', params.tools.map(t => t.function.name).join(', '));
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`DeepSeek API 错误 ${resp.status}: ${err.slice(0, 200)}`);
    }
    const result = await resp.json();

    if (hasTools && process.env.DEBUG_TOOLS) {
      const tc = result.choices?.[0]?.message?.tool_calls;
      console.error('[DEBUG TOOLS] response tool_calls:', tc ? JSON.stringify(tc).slice(0, 300) : 'NONE');
      console.error('[DEBUG TOOLS] response content:', result.choices?.[0]?.message?.content?.slice(0, 100));
    }

    return result;
  }

  /** 解析 ANALYZING 结果：提取字母 + logprobs */
  parseAnalyzingResult(result) {
    const choice = result.choices?.[0];
    if (!choice) return { letter: null, probability: 0 };

    // 去反引号/引号/空白后取首字母
    const raw = (choice.message?.content || '').trim();
    const letter = raw.replace(/[`'"`]/g, '').trim().charAt(0).toUpperCase() || null;
    if (letter && !/^[A-Z]$/.test(letter)) return { letter: null, probability: 0 };

    // logprobs: 找第一个字母 token（跳过 BOM/空白/非字母 token）
    let probability = 0;
    if (choice.logprobs?.content) {
      for (const token of choice.logprobs.content) {
        const tokenText = (token.token || '').trim();
        if (/^[A-Z]$/i.test(tokenText) && token.logprob !== undefined) {
          probability = Math.exp(token.logprob);
          break;
        }
      }
    }

    return { letter, probability, raw: choice.message?.content };
  }

  // === IN_SESSION: 通用对话 ===

  /** 构造 IN_SESSION prompt */
  buildInSessionPrompt(systemPrompt, messages, tools, modelOverride = null) {
    const model = modelOverride || getTunable(this._tunables, 'inSessionModel');
    return {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: getTunable(this._tunables, 'temperatureInSession'),
      max_tokens: 4096,
      ...(tools?.length > 0 ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
    };
  }

  /** 调用 IN_SESSION */
  async callInSession(systemPrompt, messages, tools = [], modelOverride = null) {
    const params = this.buildInSessionPrompt(systemPrompt, messages, tools, modelOverride);
    return this._call(params);
  }

  /** 解析 IN_SESSION 结果 + isOnTask 前置拦截 */
  parseInSessionResult(result) {
    const choice = result.choices?.[0];
    if (!choice) return { content: '', turnType: null, toolCalls: [], isOnTask: null };

    const raw = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls || [];

    // ═══ isOnTask 前置拦截 ═══
    const onTaskResult = this._extractIsOnTask(raw);
    // 情况1: 开头不是 {isOnTask: ...} → 需要模型重新生成
    if (onTaskResult.status === 'missing') {
      return { content: '', turnType: null, toolCalls: [], isOnTask: null, retry: true };
    }
    // 情况2+3: isOnTask:false → 路由 ANALYZING
    if (onTaskResult.status === 'false') {
      return { content: '', turnType: 'off-task', toolCalls: [], isOnTask: false };
    }
    // 情况4: isOnTask:true → 截断前缀，返回剩余内容
    const content = onTaskResult.rest || raw;

    // 从 content 中提取 turnType
    let turnType = null;
    const match = content.match(/turnType\s*[=:]\s*['"]?(\w+(?:-\w+)?)['"]?/i);
    if (match) turnType = match[1];

    return { content, turnType, toolCalls, isOnTask: true };
  }

  /** 从模型输出开头提取 {isOnTask: true/false} */
  _extractIsOnTask(raw) {
    if (!raw) return { status: 'missing' };
    // 跳过可能的空白和 markdown 代码块标记
    const trimmed = raw.replace(/^```json?\s*\n?/, '').trim();
    // 匹配 {isOnTask: true/false}
    const match = trimmed.match(/^{\s*['"]?isOnTask['"]?\s*:\s*(true|false)\s*,?\s*\}?/i);
    if (!match) return { status: 'missing' };
    if (match[1].toLowerCase() === 'false') return { status: 'false' };
    // 截断 isOnTask 前缀（包括可能的逗号和后面的换行）
    const rest = trimmed.replace(/^{\s*['"]?isOnTask['"]?\s*:\s*true\s*,?\s*\}?\s*\n?/, '').trim();
    return { status: 'true', rest };
  }

  // === N13: 代码专项模型 ===

  async callCodeModel(systemPrompt, messages, tools = []) {
    return this._call({
      model: getTunable(this._tunables, 'codeModel'),
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: getTunable(this._tunables, 'temperatureCode'),
      max_tokens: 8192,
      ...(tools?.length > 0 ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
    });
  }

  // === 辅助 ===

  /** 从 L3 boundary 生成 intent 描述（通用 SDK：不硬编码 P0-N15） */
  _describeIntent(intent) {
    // 优先从 L3 doList 读取
    if (this._doList) {
      const entry = this._doList.find(d => d.intent === intent);
      if (entry?.description) return entry.description;
    }
    // 回退：MetaAgent 设计流程硬编码描述（SDK 使用者无需关心）
    const map = {
      P0: '认知加载——理解态控核心概念',
      N1: '场景定义与边界划定',
      N2: '边界紧张度测试',
      N3: '状态枚举与执行体分派',
      N4: '状态转移图与路由表',
      N5: '调度器核心逻辑与上下文管理器',
      N6: '数据传递协议与守卫规则',
      N7: '根宪法与架构机制',
      N8: '架构机制核查',
      N9: '环节宪法编写',
      N10: 'tunable 参数声明',
      N11: '契约对齐(27项检查)',
      N12: 'L2→L3 拆包',
      N13: '骨架代码生成',
      N14: '审骨架',
      N15: '调参交付',
      'domain-rule-session': '领域规则讨论——确认/修改/仲裁/废弃规则',
      other: '无法归类或元指令',
    };
    return map[intent] || intent;
  }
}
