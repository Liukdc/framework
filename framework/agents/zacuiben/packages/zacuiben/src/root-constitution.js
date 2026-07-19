// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 根宪法 — 杂碎本 v3.0
 *
 * 基于 L3 constitutions/root-constitution.json 8 条不可变宪法。
 * 所有条款经 deepFreeze 递归冻结，任何修改尝试均静默失败。
 * 提供 validateAgainstRoot() 校验函数。
 *
 * @module zacuiben/root-constitution
 */

// ═══════════════════════════════════════════════════════════
// deepFreeze — 递归冻结
// ═══════════════════════════════════════════════════════════

/**
 * 深度冻结一个对象（含嵌套对象/数组），使其完全 immutable。
 * 在严格模式下尝试修改会抛出 TypeError；非严格模式下静默失败。
 *
 * @template T
 * @param {T} obj
 * @returns {Readonly<T>}
 */
export function deepFreeze(obj) {
  if (obj == null || typeof obj !== 'object') return obj;

  // 冻结自身
  Object.freeze(obj);

  // 递归冻结所有自有属性
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }

  return obj;
}

// ═══════════════════════════════════════════════════════════
// 8 条根宪法
// ═══════════════════════════════════════════════════════════

/**
 * 根宪法全文 — 8 条不可变条款
 * 所有条款 type 均为 "immutable"
 */
export const ROOT_CONSTITUTION = deepFreeze({
  constitution: 'root',
  version: 'v3.0',

  articles: Object.freeze([
    Object.freeze({
      id: 1,
      name: '安全红线',
      content: '不上传用户数据，不分享给第三方，不用于训练。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 2,
      name: '元指令',
      content: '用户原始输入是唯一数据源。不修改、不概括、不解释。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 3,
      name: '收敛义务',
      content: '每次只做一件事。一个 intent = 一次 LLM 调用。5 个 intent 闭环。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 4,
      name: '输出格式',
      content: 'turnType 六值 + askingField + changeLevel + changeLevelReason + message + collectedFields。JSON 格式。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 5,
      name: '跨任务延伸检测',
      content: 'field_based 场景使用字段白名单，needSemanticExtensionCheck=false。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 6,
      name: '状态间数据传递',
      content: '严格遵守 N6 传递协议，不跨状态携带未声明数据。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 7,
      name: '三类保护机制',
      content: '原始输入保护（不修改）+ 草稿保护（不清理未到期记录）+ 数据保护（不上传云端）。',
      type: 'immutable',
    }),
    Object.freeze({
      id: 8,
      name: '模糊目标处理',
      content: '缺 Key→自动生成临时 Key。缺搜索 Key→反问引导。',
      type: 'immutable',
    }),
  ]),
});

// ═══════════════════════════════════════════════════════════
// 便捷访问
// ═══════════════════════════════════════════════════════════

/** 条款索引 Map<number, article> */
const ARTICLE_MAP = new Map();
for (const article of ROOT_CONSTITUTION.articles) {
  ARTICLE_MAP.set(article.id, article);
}

/**
 * 按 ID 获取宪法条款
 * @param {number} id - 条款 ID（1-8）
 * @returns {Object|undefined}
 */
export function getArticle(id) {
  return ARTICLE_MAP.get(id);
}

/**
 * 获取所有条款
 * @returns {Readonly<Array<Object>>}
 */
export function getAllArticles() {
  return ROOT_CONSTITUTION.articles;
}

// ═══════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════

/**
 * 验证输出是否符合根宪法要求
 *
 * 检查项：
 * - turnType 是否在六值内
 * - 是否包含 changeLevel + changeLevelReason
 * - message 是否 ≤30 字
 * - 原始输入是否未被修改（传入 originalInput 时检查）
 *
 * @param {Object} output - 待验证的输出对象
 * @param {Object} [opts]
 * @param {string} [opts.originalInput] - 用户原始输入（用于元指令校验）
 * @returns {{ valid: boolean, violations: Array<{article:number, articleName:string, detail:string}> }}
 */
export function validateAgainstRoot(output, opts = {}) {
  /** @type {Array<{article:number, articleName:string, detail:string}>} */
  const violations = [];

  if (!output || typeof output !== 'object') {
    violations.push({
      article: 4,
      articleName: '输出格式',
      detail: '输出必须为 JSON 对象',
    });
    return { valid: false, violations };
  }

  // 第 4 条：输出格式 — turnType 六值
  const validTurnTypes = new Set(['ask', 'reply', 'complete', 'off-task', 'giveup', 'validation_failed']);
  if (!output.turnType || !validTurnTypes.has(output.turnType)) {
    violations.push({
      article: 4,
      articleName: '输出格式',
      detail: `turnType 必须为六值之一，收到: ${output.turnType}`,
    });
  }

  // 第 4 条：changeLevel + changeLevelReason
  const validChangeLevels = new Set(['major', 'minor', 'invalid']);
  if (!output.changeLevel || !validChangeLevels.has(output.changeLevel)) {
    violations.push({
      article: 4,
      articleName: '输出格式',
      detail: 'changeLevel 必须为 major/minor/invalid 之一',
    });
  }

  // 第 4 条：message ≤30 字
  if (typeof output.message === 'string' && output.message.length > 30) {
    violations.push({
      article: 4,
      articleName: '输出格式',
      detail: `message 超过 30 字限制（${output.message.length} 字）`,
    });
  }

  // 第 2 条：元指令 — 原始输入不被修改
  if (opts.originalInput && output.collectedFields) {
    const cf = output.collectedFields;
    // content 字段应与原始输入一致
    if (cf.content && opts.originalInput !== cf.content) {
      violations.push({
        article: 2,
        articleName: '元指令',
        detail: 'collectedFields.content 与用户原始输入不一致',
      });
    }
  }

  // 第 3 条：收敛义务 — 单 intent 闭环
  // 如果 output 同时声称多个 task 完成，则违反
  // 此处由上层在调用时通过 collectedFields 的多字段情况判断

  return { valid: violations.length === 0, violations };
}

/**
 * 检查对象是否已冻结（所有属性不可变）
 * 用于确认宪法条款未被篡改
 *
 * @returns {{ frozen: boolean, articleCount: number }}
 */
export function verifyIntegrity() {
  const rootFrozen = Object.isFrozen(ROOT_CONSTITUTION);
  const articlesFrozen = Object.isFrozen(ROOT_CONSTITUTION.articles);
  let allArticlesFrozen = articlesFrozen;

  if (articlesFrozen) {
    for (const article of ROOT_CONSTITUTION.articles) {
      if (!Object.isFrozen(article)) {
        allArticlesFrozen = false;
        break;
      }
    }
  }

  return {
    frozen: rootFrozen && allArticlesFrozen,
    articleCount: ROOT_CONSTITUTION.articles.length,
  };
}
