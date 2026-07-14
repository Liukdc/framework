// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 记账环节宪法 — 基于 L3 record-session.json
 *
 * 模型实例在局部宪法约束下自主追问+校验+偏离检测，
 * 返回统一 turnType 格式（含 changeLevel + changeLevelReason）的结构化结果给调度器。
 *
 * @module fugui-xiaoan/constitution-record
 */

import { TurnType, ChangeLevel, AskingField } from './turnType.js';

// ═══ 字段规则（L3: fieldRules - 4 字段按 order） ═══
export const RECORD_FIELD_RULES = Object.freeze({
  fields: Object.freeze([
    Object.freeze({
      name: 'category',
      order: 1,
      required: true,
      description: "Expense category. Record user's exact words, do not classify.",
      parseMethod: 'verbatim',
      parseRule: "Record user's exact words.",
    }),
    Object.freeze({
      name: 'amount',
      order: 2,
      required: true,
      description: 'Amount in yuan.',
      parseMethod: 'regex',
      parseRule: '/(\\d+\\.?\\d*)/',
    }),
    Object.freeze({
      name: 'time',
      order: 3,
      required: true,
      description: 'Time: yesterday/today/tomorrow/specific date.',
      parseMethod: 'dictionary',
      parseRule: 'yesterday|today|tomorrow|\\d+/\\d+|\\d+th',
    }),
    Object.freeze({
      name: 'quantity',
      order: 4,
      required: false,
      description: 'Quantity, default 1.',
    }),
  ]),
});

// ═══ 校验规则（L3: validation.rules） ═══
export const RECORD_VALIDATION_RULES = Object.freeze([
  Object.freeze({ field: 'amount', type: 'range', min: 0, exclusiveMin: true, error_tag: 'amount_invalid' }),
  Object.freeze({ field: 'amount', type: 'range', min: 0, max: 999999, error_tag: 'amount_too_large' }),
  Object.freeze({ field: 'time', type: 'not_future', error_tag: 'time_future' }),
  Object.freeze({ field: 'quantity', type: 'range', min: 0, exclusiveMin: true, error_tag: 'quantity_invalid' }),
]);

export const RECORD_REQUIRED_FIELDS = Object.freeze(['category', 'amount', 'time']);

// ═══ 追问规则（L3: askRules） ═══
export const RECORD_ASK_RULES = Object.freeze({
  order: 'Ask fields in order. One at a time. Strongly related fields may be asked together.',
  mainSubRule:
    'field_based mode: strongly related fields can be asked in one round. Mark primary field first in askingField.',
  timeDefault: "If user does not specify time, default to 'today'.",
});

// ═══ DET 值域约束 ═══════════════════════
const VALUE_CONSTRAINTS = Object.freeze({
  amount: { min: 0, exclusiveMin: true, max: 999999, message: '金额似乎有问题，请重新输入。' },
  time: { maxFuture: false, message: '时间不能在未来，请重新输入。' },
  quantity: { min: 0, exclusiveMin: true, max: 10000, message: '数量似乎有问题，请重新输入。' },
});

/**
 * DET 值域复验（由调度器在 complete 前调用）。
 *
 * @param {object} result - { category, amount, time, quantity, unit }
 * @returns {{ valid: boolean, message?: string, field?: string }}
 */
export function detValidateRecord(result) {
  if (!result) return { valid: true };

  const { amount, time, quantity } = result;

  // amount 校验
  if (amount !== null && amount !== undefined) {
    const c = VALUE_CONSTRAINTS.amount;
    if (amount <= c.min) {
      return { valid: false, message: `金额必须大于${c.min}，请重新输入。`, field: 'amount' };
    }
    if (amount > c.max) {
      return { valid: false, message: c.message, field: 'amount' };
    }
  }

  // time 校验（未来检查）
  if (time && typeof time === 'string') {
    const now = new Date();
    const parsed = _parseTimeForValidation(time);
    if (parsed && parsed > now) {
      return { valid: false, message: VALUE_CONSTRAINTS.time.message, field: 'time' };
    }
  }

  // quantity 校验
  if (quantity !== null && quantity !== undefined) {
    const c = VALUE_CONSTRAINTS.quantity;
    if (quantity <= c.min) {
      return { valid: false, message: c.message, field: 'quantity' };
    }
    if (quantity > c.max) {
      return { valid: false, message: c.message, field: 'quantity' };
    }
  }

  return { valid: true };
}

function _parseTimeForValidation(t) {
  const now = new Date();
  const text = t.trim();
  if (text === '今天') return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (text === '昨天')
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
  if (text === '明天')
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  if (text === '后天')
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

// ═══ 宪法文本生成 ═══════════════════════

/**
 * 拼接待注入 LLM 的记账环节宪法文本（基于 L3 record-session.json）。
 *
 * @param {'simple'|'detailed'} mode
 * @returns {string}
 */
export function recordConstitution(mode = 'simple') {
  const fields =
    mode === 'detailed'
      ? '种类 → 金额 → 时间 → 数量(含单位)'
      : '种类 → 金额 → 时间';

  return `【角色】
你是用户的记账助手。用户正在记账，你要引导完成一笔完整记账。
主动询问缺失字段，直到所有必采字段齐全。

【字段采集顺序】${fields}
数量默认1（简单模式），时间默认"今天"。

【值域校验 — 你必须在内部执行】
- amount ≤ 0 → 拒绝，返回 validationResult:{field:"amount",issue:"amount_invalid",userInput:"<用户输入>"}
- amount > 999999 → 拒绝，返回 validationResult:{field:"amount",issue:"amount_too_large",userInput:"<用户输入>"}
- time > 今天 → 拒绝，返回 validationResult:{field:"time",issue:"time_future",userInput:"<用户输入>"}
- quantity ≤ 0 → 拒绝，返回 validationResult:{field:"quantity",issue:"quantity_invalid",userInput:"<用户输入>"}
校验失败时 turnType="validation_failed"，askingField=失败字段名，message 为自然语言提示，collectedFields 包含已采集字段。

【解析优先级】
- 金额/数量: 正则 /(\\d+\\.?\\d*)/ → 优先填入
- 时间: 词典匹配 今天/昨天/明天/后天/N号/N月N日 → 优先填入
- 种类: 直接记录用户原话，不做分类转换。猫粮就是猫粮。

【追问规则】
- 一次只问一项，按顺序
- 用户回答 → 填入该字段，继续下一项
- 不说具体时间 → 默认"今天"
- 追问到所有字段齐全

【changeLevel】
- major: 用户修改已采集的字段、切换意图
- minor: 补充新字段、追加信息
- invalid: 输入格式有误但可纠正
- 每次 turn 必须输出 changeLevel 和 changeLevelReason（1-100字）

【完成条件】所有字段齐全 → turnType="complete"，message="已记录：XX YY元"，result={category,amount,time,quantity,unit}

【修改】"记错了"/"不对"/"改一下" → 追问"哪个需要改？"，changeLevel="major"
指定字段 → 回到该字段重问

【放弃】"算了"/"不记了" → turnType="giveup"

【偏离检测】
用户输入明显不属于记账（查询/删除/闲聊）→ turnType="off-task"，offTaskInput=用户原话，collectedFields=已采集字段

【输出格式 — 严格 JSON，不能包含任何markdown】
{"turnType":"ask|reply|complete|off-task|giveup|validation_failed",
 "askingField":null|"category"|"amount"|"time"|"quantity",
 "message":"你对用户说的话（30字内）",
 "changeLevel":"major"|"minor"|"invalid"|null,
 "changeLevelReason":"一句话原因（1-100字）",
 "validationResult":null|{"field":"amount","issue":"amount_too_large","userInput":"..."},
 "collectedFields":{"category":null,"amount":null,"time":null,"quantity":null},
 "offTaskInput":null,
 "result":null|{"category":"猫粮","amount":35,"time":"昨天","quantity":1,"unit":"份"}}`;
}

/**
 * 构建初次进入环节的初始 prompt（buildPrompt 工厂函数）。
 *
 * @param {object} opts
 * @param {string} opts.userInput - 用户本轮输入
 * @param {object} opts.collectedFields - 已采集字段
 * @param {'simple'|'detailed'} [opts.mode='simple'] - 记账模式
 * @returns {{ system: string, user: string }}
 */
export function buildRecordPrompt({ userInput, collectedFields, mode = 'simple' }) {
  const fields = {
    category: collectedFields?.category || null,
    amount: collectedFields?.amount || null,
    time: collectedFields?.time || null,
    quantity: collectedFields?.quantity || (mode === 'detailed' ? null : 1),
    unit: collectedFields?.unit || '',
  };
  return {
    system: recordConstitution(mode),
    user: JSON.stringify({ userInput, collectedFields: fields }),
  };
}

export default recordConstitution;
