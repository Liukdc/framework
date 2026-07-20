// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * DeepSeek LLM 客户端适配器 — 富贵小安 v5.8
 *
 * 支持 function calling (v5.4) + 工具分层 (v5.5)
 * API: https://api.deepseek.com/v1/chat/completions
 *
 * @module fugui-xiaoan/deepseek-adapter-v5.8
 */

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

export class DeepSeekAdapter {
  constructor({ apiKey, baseUrl, model } = {}) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY;
    this.baseUrl = baseUrl || DEFAULT_BASE;
    this.model = model || DEFAULT_MODEL;
  }

  /** ANALYZING: 意图识别（强制选择+logprobs） */
  async analyze(userInput) {
    const prompt = `你是意图识别环节。将用户输入映射到以下intent：
A=record（记账） B=query（查询） C=delete（删除） D=compare（对比） E=other（其他）
并判断输入性质：S=闲聊 T=任务导向 U=不确定
只输出一个字母作为choice。

用户输入: "${userInput}"`;

    const resp = await this._call({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 10,
      logprobs: true,
      top_logprobs: 5,
    });

    const choice = resp.choices?.[0]?.message?.content?.trim().charAt(0) || 'E';
    const logprobs = resp.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs || [];

    // 二次分类: 判断输入性质 S/T/U
    const inputNature = await this._classifyNature(userInput);

    return {
      choice,
      logprobs,
      intent: this._mapIntent(choice),
      extracted: this._extractFields(userInput),
      inputNature,
      probability: Math.exp(logprobs.find(l => l.token === choice)?.logprob ?? -5),
    };
  }

  /** IN_SESSION: 环节内对话（含tool calling） */
  async chat({ messages, tools, constitution }) {
    const systemMsg = constitution ? [{ role: 'system', content: constitution }] : [];
    const allMessages = [...systemMsg, ...messages];

    const body = {
      model: this.model,
      messages: allMessages,
      temperature: 0.3,
      max_tokens: 500,
    };

    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const resp = await this._call(body);
    const msg = resp.choices?.[0]?.message;

    if (msg?.tool_calls?.length) {
      return { tool_calls: msg.tool_calls };
    }

    // 解析 turnType（从模型返回的 JSON 中提取）
    try {
      const content = msg?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}

    return { turnType: 'reply', message: msg?.content || '' };
  }

  // ═══ 内部方法 ═══════════════════════════════
  async _call(body) {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  _mapIntent(choice) {
    return { A:'record', B:'query', C:'delete', D:'compare', E:'other' }[choice] || 'other';
  }

  _extractFields(input) {
    const extracted = {};
    const amtMatch = input.match(/(\d+\.?\d*)\s*(元|块)?/);
    if (amtMatch) extracted.amount = Number(amtMatch[1]);
    const catMatch = input.match(/(?:记|买|花了?)\s*(.+?)(?:\d|$)/);
    if (catMatch) extracted.category = catMatch[1].trim();
    return extracted;
  }

  async _classifyNature(input) {
    // 简单关键词分类（生产环境用轻量LLM）
    const chat = ['你好','天气','哈哈','嗯嗯','哦','在吗'];
    const task = ['帮','分析','制作','生成','写','计算'];
    if (chat.some(w => input.includes(w))) return 'S';
    if (task.some(w => input.includes(w))) return 'T';
    return 'U';
  }
}

/** 无API Key时的降级适配器（编程规则宪法第4条: 拒绝服务） */
export class NoAPIKeyAdapter {
  async analyze() { throw new Error('无DeepSeek API Key。请设置 DEEPSEEK_API_KEY 环境变量。降级非正道。'); }
  async chat() { throw new Error('无DeepSeek API Key。请设置 DEEPSEEK_API_KEY 环境变量。降级非正道。'); }
}

/** 工厂函数 */
export function createLLMClient({ apiKey, baseUrl, model } = {}) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) return new NoAPIKeyAdapter();
  return new DeepSeekAdapter({ apiKey: key, baseUrl, model });
}
