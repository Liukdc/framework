// @MetaAgent v5.8 — deepseek-adapter.js
// DeepSeek API 适配器：ANALYZING 强制选择+logprobs、IN_SESSION 通用对话、N13 代码专项

import { getTunable } from './tunables.js';

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

export class DeepSeekAdapter {
  constructor(tunables) {
    this._tunables = tunables;
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
      max_tokens: 2,
      logprobs: true,
      top_logprobs: 5,
    };
  }

  /** 调用 DeepSeek API */
  async _call(params) {
    const url = `${DEEPSEEK_BASE_URL}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`DeepSeek API 错误 ${resp.status}: ${err.slice(0, 200)}`);
    }
    return resp.json();
  }

  /** 解析 ANALYZING 结果：提取字母 + logprobs */
  parseAnalyzingResult(result) {
    const choice = result.choices?.[0];
    if (!choice) return { letter: null, probability: 0 };

    const letter = choice.message?.content?.trim()?.charAt(0)?.toUpperCase() || null;

    // logprobs 概率
    let probability = 0;
    if (choice.logprobs?.content?.[0]?.logprob !== undefined) {
      probability = Math.exp(choice.logprobs.content[0].logprob);
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
      ...(tools?.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    };
  }

  /** 调用 IN_SESSION */
  async callInSession(systemPrompt, messages, tools = [], modelOverride = null) {
    const params = this.buildInSessionPrompt(systemPrompt, messages, tools, modelOverride);
    return this._call(params);
  }

  /** 解析 IN_SESSION 结果 */
  parseInSessionResult(result) {
    const choice = result.choices?.[0];
    if (!choice) return { content: '', turnType: null, toolCalls: [] };

    const content = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls || [];

    // 从 content 中提取 turnType（模型在宪法约束下返回）
    let turnType = null;
    const match = content.match(/turnType\s*[=:]\s*['"]?(\w+(?:-\w+)?)['"]?/i);
    if (match) turnType = match[1];

    return { content, turnType, toolCalls };
  }

  // === N13: 代码专项模型 ===

  async callCodeModel(systemPrompt, messages) {
    return this._call({
      model: getTunable(this._tunables, 'codeModel'),
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: getTunable(this._tunables, 'temperatureCode'),
      max_tokens: 8192,
    });
  }

  // === 辅助 ===

  _describeIntent(intent) {
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
      other: '无法归类或元指令',
    };
    return map[intent] || intent;
  }
}
