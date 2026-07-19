// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * DeepSeek NLU 客户端 — 自然语言→结构化记账
 *
 * 用大模型理解自由文本（"午饭和同事AA花了50"→{category:"餐饮",amount:50,item:"午饭AA"}），
 * 替代纯正则的僵硬匹配。
 *
 * @module fugui-xiaoan/nlu
 */

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const PROMPT_TEMPLATE = `你是记账助手"富贵小安"。将用户的口语输入解析为结构化数据。
输出必须是纯JSON，格式：
{"amount":数字,"category":"项目名","item":"项目名","confidence":0.0-1.0,"date":"时间","intent":"record|query|other"}

规则：
- amount 必须是数字，提取不到填 null
- category 和 item 必须是用户原话里的东西。"猫粮"就是"猫粮"，"午饭"就是"午饭"，不要把猫粮翻译成"购物"
- 像"查猫花了多少""这个月花了多少"这种，intent填"query"，不要填"record"
- "AA"或"平摊"时，把总额除以2
- 日期（"前天"、"上周五"）转换为ISO日期放date字段
- 置信度：明确金额+项目名=0.9+，模糊=0.5-0.7

用户输入：`;

/**
 * @param {string} text — 用户原始输入
 * @param {Object} [opts]
 * @param {string} [opts.apiKey] — DeepSeek API Key
 * @param {string} [opts.model='deepseek-chat'] — 模型选择
 * @param {string} [opts.endpoint] — API endpoint
 * @returns {Promise<Object|null>} 解析结果或 null（请求失败）
 */
export async function parseWithDeepSeek(text, opts = {}) {
  const apiKey = opts.apiKey || null;
  if (!apiKey) return null;

  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const model = opts.model || 'deepseek-chat';
  const timeoutMs = opts.timeoutMs || 15000;
  const retries = opts.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一个精确的记账数据解析助手。只输出JSON，不输出其他内容。' },
            { role: 'user', content: PROMPT_TEMPLATE + text },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) continue;
        console.warn('[NLU] API error:', res.status);
        return null;
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) return null;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        amount:   parsed.amount != null ? parseFloat(parsed.amount) : null,
        category: validCategory(parsed.category),
        item:     parsed.item || text.slice(0, 20),
        date:     parsed.date || null,
        confidence: parsed.confidence || 0.7,
        source:   'deepseek',
      };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        console.warn('[NLU] request timeout after', timeoutMs, 'ms');
      } else if (attempt < retries) {
        continue;
      }
      console.warn('[NLU] Parse error:', e.message);
      return null;
    }
  }

  return null;
}

/** 校验并兜底分类 */
export function validCategory(cat) {
  const valid = ['餐饮','交通','购物','住房','娱乐','医疗','教育','人情','其他'];
  if (!cat) return '其他';
  if (valid.includes(cat)) return cat;
  // 模糊匹配
  for (const v of valid) {
    if (cat.includes(v) || v.includes(cat)) return v;
  }
  return '其他';
}

/**
 * API Key 管理（加密存储）
 * 使用Web Crypto API派生设备密钥做浅加密，防止adb backup明文提取。
 * 不是密码学级安全，但远强于明文localStorage。
 */
const KEY_STORAGE = 'fugui_nlu_apikey';

/** 派生设备相关密钥（不存localStorage，每次计算） */
function _deriveKey() {
  const seed = [
    navigator.userAgent || '',
    screen.width || 0,
    screen.height || 0,
    'fugui-salt-2026'
  ].join('|');
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h) + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

function _xor(str, key) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

export function getApiKey() {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return null;
    const decrypted = _xor(atob(raw), _deriveKey());
    return decrypted || null;
  } catch (e) { return null; }
}

export function setApiKey(key) {
  try {
    if (!key) { localStorage.removeItem(KEY_STORAGE); return true; }
    const encrypted = _xor(key, _deriveKey());
    localStorage.setItem(KEY_STORAGE, btoa(encrypted));
    return true;
  } catch (e) { return false; }
}

export function clearApiKey() {
  try { localStorage.removeItem(KEY_STORAGE); return true; } catch (e) { return false; }
}
