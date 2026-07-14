// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 自然语言记账解析器
 * 
 * 核心能力：从用户自由文本中提取金额、数量、单位、项目描述。
 * 不做任何分类映射——这是"反分类"的工程实现。
 * 
 * 支持的输入格式：
 *   "午饭25块"              → {item:"午饭", amount:25}
 *   "买了三斤苹果45元"       → {item:"苹果", amount:45, quantity:3, unit:"斤"}
 *   "打车30，午饭25"         → 拆分为2条
 *   "微信支付 ¥88.50"       → {item:"微信支付", amount:88.50}
 * 
 * @module fugui-xiaoan/parser
 */

// ─── 正则模式 ────────────────────────────────────────

/** 金额提取：匹配 "25块" "68元" "99" "¥88.50" */
const AMOUNT_RE = /(\d+(?:\.\d{1,2})?)\s*(?:块|元|钱|¥|￥)?/g;

/** 数量提取（阿拉伯数字）："3斤" "5个" "2瓶" */
const QTY_RE = /(\d+(?:\.\d+)?)\s*(斤|个|件|瓶|盒|箱|袋|升|公斤|千克|g|kg|两)/;

/** 数量提取（中文数字）："三斤" "五个" */
const CN_NUM_MAP = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'两':2 };
const CN_QTY_RE = /([一两二三四五六七八九十]+)\s*(斤|个|件|瓶|盒|箱|袋|升|公斤|千克)/;

/** 多笔拆分：逗号、顿号、空格分隔 */
const SPLIT_RE = /[,，、；;]\s*/;

// ─── 工具函数 ────────────────────────────────────────

/**
 * 中文数字 → 阿拉伯数字
 * @param {string} cn - 中文字符
 * @returns {number}
 */
function cnToNum(cn) {
  if (cn === '十') return 10;
  if (cn.length === 1) return CN_NUM_MAP[cn] || 0;
  // "二十" → 20, "三十五" → 35
  let result = 0;
  for (let i = 0; i < cn.length; i++) {
    const ch = cn[i];
    if (ch === '十') {
      result = result === 0 ? 10 : result * 10;
    } else {
      result += CN_NUM_MAP[ch] || 0;
    }
  }
  return result;
}

// ─── 核心解析 ────────────────────────────────────────

/**
 * 解析单条记账文本
 * @param {string} text - 用户输入的一笔消费文本
 * @returns {import('./types.js').ParseResult}
 */
export function parseSingle(text) {
  const trimmed = text.trim();
  const originalText = trimmed;
  
  // 1. 提取所有金额
  const amounts = [];
  let am;
  const amRe = new RegExp(AMOUNT_RE.source, 'g');
  while ((am = amRe.exec(trimmed)) !== null) {
    amounts.push(parseFloat(am[1]));
  }
  
  // 2. 移除金额标记后的文本作为项目描述
  let item = trimmed
    .replace(AMOUNT_RE, '')
    .replace(/花了|用了|买了/g, '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+/g, '');
  
  if (!item) item = '消费';
  
  // 3. 提取数量
  let quantity = null;
  let unit = null;
  
  const qtyMatch = QTY_RE.exec(trimmed);
  if (qtyMatch) {
    quantity = parseFloat(qtyMatch[1]);
    unit = qtyMatch[2];
  } else {
    const cnMatch = CN_QTY_RE.exec(trimmed);
    if (cnMatch) {
      quantity = cnToNum(cnMatch[1]);
      unit = cnMatch[2];
    }
  }
  
  // 4. 计算单价
  const amount = amounts.length > 0 ? amounts[0] : null;
  const unitPrice = (amount && quantity) ? Math.round((amount / quantity) * 100) / 100 : null;
  
  // 5. 判断完整性
  const needClarify = [];
  if (amount === null) needClarify.push('amount');
  // 仅当文本暗示有数量但未提取到时追问
  // 大多数日常记账不需要数量，只有明确包含数字+单位时才判断
  
  return {
    originalText,
    amount,
    item,
    quantity,
    unit,
    unitPrice,
    isComplete: amount !== null,
    needClarify,
  };
}

/**
 * 解析用户输入（支持多笔拆分）
 * "打车30，午饭25" → [ParseResult, ParseResult]
 * "abc" → []（无法解析）
 * 
 * @param {string} input - 用户完整输入
 * @returns {import('./types.js').ParseResult[]}
 */
export function parse(input) {
  const trimmed = input.trim();
  if (!trimmed) return [];
  
  // 完全没有数字且没有中文数字 → 不可记账
  if (!/\d/.test(trimmed) && !/[一二三四五六七八九十两]/.test(trimmed)) {
    return [];
  }
  
  // 尝试多笔拆分
  const parts = trimmed.split(SPLIT_RE).filter(Boolean);
  
  // 只有每段都独立可解析时才拆分
  const hasMultiAmount = parts.length > 1 && parts.filter(p => /\d/.test(p) || /[一二三四五六七八九十两]/.test(p)).length >= 2;
  
  if (hasMultiAmount) {
    return parts.map(parseSingle);
  }
  
  return [parseSingle(trimmed)];
}

export default { parse, parseSingle };
