// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 追问话术模板 — 硬编码，不调 LLM
 *
 * 追问话术模式固定：缺什么问什么，一次只问一项。
 * 高速交互不需要 LLM 的生成能力，硬编码省延迟、体验一致。
 *
 * @module clarify-templates
 */

const TEMPLATES = {
  simple: {
    category: '这个钱是花在什么上面了呢？',
    amount:   '{category}多少钱呀？',
    time:     '是什么时候花的呢？',
  },
  detailed: {
    category: '这个钱是花在什么上面了呢？',
    amount:   '{category}多少钱呀？',
    time:     '是什么时候花的呢？',
    quantity: '买了多少呢？比如 2 斤或 1 份',
  },
};

/**
 * @param {string} field — 缺失的字段名: category/amount/time/quantity
 * @param {string} mode  — "simple" | "detailed"
 * @param {string} [category] — 种类（用于 price 模板拼接）
 * @returns {string}
 */
export function clarifyQuestion(field, mode, category) {
  const tpls = TEMPLATES[mode] || TEMPLATES.simple;
  const tpl = tpls[field] || `请说一下${field}`;
  return tpl.replace('{category}', category || '这个');
}

/**
 * 尝试解析用户输入，填入对应字段
 * @param {string} text  — 用户输入
 * @param {string} field — 当前追问的字段
 * @returns {string|number|null} 解析到的值，或 null（失败）
 */
export function tryParseField(text, field) {
  switch (field) {
    case 'amount': {
      const m = text.match(/(\d+\.?\d*)/);
      return m ? parseFloat(m[1]) : null;
    }
    case 'category':
      return text.trim() || null;
    case 'time':
      return text.trim() || null;
    case 'quantity': {
      const m = text.match(/(\d+\.?\d*)/);
      return m ? parseFloat(m[1]) : null;
    }
    default:
      return text.trim() || null;
  }
}

// ── 值域守卫（v1.5.1 新增，确定性代码，零 LLM）──

const TIME_WORDS = new Map([
  ['今天', 0], ['昨天', 1], ['前天', 2], ['明天', 3], ['后天', 4],
  ['上周', 7], ['上星期', 7], ['本周', 0], ['这周', 0], ['下周', 7],
  ['上月', 30], ['上个月', 30], ['本月', 0], ['这个月', 0], ['下月', 30], ['下个月', 30],
]);

/**
 * 值域校验 — 硬解析成功后、填入 _fields 前执行
 * @param {string} field — amount/time/quantity
 * @param {*} value — parseFloat 或 trim 后的值
 * @returns {{ ok: boolean|'confirm', reason?: string }}
 */
export function validateFieldValue(field, value) {
  if (field === 'amount') {
    if (value <= 0) return { ok: false, reason: '金额需要大于0，请重新输入。' };
    if (value > 999999) return { ok: false, reason: '金额似乎过大，请确认后重新输入。' };
  }
  if (field === 'time' && typeof value === 'string') {
    const clean = value.trim();
    if (/\d/.test(clean) && !TIME_WORDS.has(clean)) {
      // 含数字但不在词典中 → 可能在未来（正则宽松匹配留给高阶场景）
      return { ok: true };
    }
    if (TIME_WORDS.has(clean)) {
      const daysOffset = TIME_WORDS.get(clean);
      if (daysOffset > 1) {
        return { ok: 'confirm', reason: `时间是"${clean}"对吗？` };
      }
    }
  }
  if (field === 'quantity') {
    if (value <= 0) return { ok: false, reason: '数量需要大于0，请重新输入。' };
  }
  return { ok: true };
}
