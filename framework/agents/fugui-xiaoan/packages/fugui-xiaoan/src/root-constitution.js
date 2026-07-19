// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 根宪法 — 基于 L3 root-constitution.json（7 条）
 *
 * 全局静态硬编码，设计者写死，不接受运行时动态修改。
 * deepFreeze 递归冻结所有嵌套对象。不可变。
 *
 * @module fugui-xiaoan/root-constitution
 */

import { TUNABLES } from './tunables.js';

// ═══ Appendix A.1: deepFreeze ═══════════════════
/**
 * 递归冻结对象及其所有嵌套子对象。
 * 与 Object.freeze 组合确保完全不可变。
 *
 * @param {object} obj
 * @returns {object} 冻结后的对象
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  // 递归冻结所有嵌套对象
  Object.keys(obj).forEach((key) => {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return Object.freeze(obj);
}

// ═══ 条款 1：元指令集 ═══════════════════
export const ARTICLE1_META_INSTRUCTION = deepFreeze({
  number: 1,
  title: 'Meta-Instruction Set',
  content: 'Passphrase layer EXACT_MATCH for 0 LLM calls. Natural language goes to semantic confirmation layer for secondary confirmation.',
  overridable: 'forbidden',
  passphrases: {
    wake: '小安开账',
    exit: '结束并且退出',
    cancel: '本次动作取消',
  },
  /** EXACT_MATCH: 口令层硬匹配规则——接受精确字符串匹配，不接受模糊/正则 */
  matchRule: 'EXACT_MATCH',
});

// ═══ 条款 2：收敛义务 ═══════════════════
export const ARTICLE2_CONVERGENCE = deepFreeze({
  number: 2,
  title: 'Convergence Obligation',
  content: 'All LLM nodes must converge within the current phase. Output structured JSON.',
  overridable: 'forbidden',
});

// ═══ 条款 3：输出格式 ═══════════════════
export const ARTICLE3_OUTPUT_FORMAT = deepFreeze({
  number: 3,
  title: 'Output Format',
  content: 'turnType schema includes changeLevel + changeLevelReason. Applicable to both taskTypes.',
  overridable: 'forbidden',
  requiredFields: ['turnType'],
  turnTypes: ['ask', 'reply', 'complete', 'off-task', 'giveup', 'validation_failed'],
});

// ═══ 条款 4：降级链 ═══════════════════
export const ARTICLE4_DEGRADATION = deepFreeze({
  number: 4,
  title: 'Degradation Chain',
  content: 'L1 structure check + DET value recheck + confidence check + cross-task extension detection + hardcoded fallback. Irreducible.',
  overridable: 'extensible_only',
  degradationChain: [
    'L1_structure_check',
    'DET_value_recheck',
    'confidence_check',
    'cross_task_extension',
    'hardcoded_fallback',
  ],
  l1Retries: 1,
  l2ForbiddenTerms: [
    '您还可以', '如果需要', '建议您', '推荐您', '不妨', '是否考虑',
  ],
  hardcodedFallback: '小安不太明白，请再说一遍。',
});

// ═══ 条款 5：仲裁权 ═══════════════════
export const ARTICLE5_ARBITRATION = deepFreeze({
  number: 5,
  title: 'Arbitration Authority',
  content: 'Dispatcher DET validation results override model internal validation results.',
  overridable: 'forbidden',
});

// ═══ 条款 6：节点转换守卫 ═══════════════════
export const ARTICLE6_TRANSITION_GUARD = deepFreeze({
  number: 6,
  title: 'Node Transition Guard',
  content: 'DET keyword scan assists deviation detection during IN_SESSION. Final judgment by model.',
  overridable: 'forbidden',
  /** DET 关键词扫描规则（第 0.5 层） */
  offTaskKeywords: {
    query:  ['查一下', '查询', '多少', '总共', '花了'],
    delete: ['删除', '删掉', '去掉'],
    exit:   ['拜拜', '退出', '好了'],
  },
});

// ═══ 条款 7：模糊目标追问模板 ═══════════════════
export const ARTICLE7_AMBIGUOUS_GOAL = deepFreeze({
  number: 7,
  title: 'Fuzzy Goal Prompt Template',
  content: 'Prompt for type/amount/time dimensions when input cannot be classified.',
  overridable: 'forbidden',
  templates: {
    record: {
      question: '这是什么时候花的？还是多少钱？',
      dimensions: ['category', 'amount', 'time'],
    },
    query: {
      question: '查单笔还是汇总？',
      dimensions: ['subType'],
    },
  },
});

// ═══ 聚合导出 ═══════════════════════════
export const ROOT_CONSTITUTION = deepFreeze([
  ARTICLE1_META_INSTRUCTION,
  ARTICLE2_CONVERGENCE,
  ARTICLE3_OUTPUT_FORMAT,
  ARTICLE4_DEGRADATION,
  ARTICLE5_ARBITRATION,
  ARTICLE6_TRANSITION_GUARD,
  ARTICLE7_AMBIGUOUS_GOAL,
]);

// ═══ 工具函数 ═══════════════════════════

/**
 * 检验局部宪法是否与根宪法冲突。
 *
 * 检查项：
 * - L1 重试次数是否低于根宪法要求
 * - 输出格式是否被修改为非 JSON
 * - overridable=forbidden 的条款是否被局部宪法试图覆盖
 *
 * @param {object} localConstitution - 局部宪法对象
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function validateAgainstRoot(localConstitution) {
  const violations = [];

  // 检查 L1 重试数
  if (
    localConstitution.l1Retries !== undefined &&
    localConstitution.l1Retries < ARTICLE4_DEGRADATION.l1Retries
  ) {
    violations.push(
      `L1 重试次数(${localConstitution.l1Retries})低于根宪法要求(${ARTICLE4_DEGRADATION.l1Retries})`
    );
  }

  // 检查输出格式
  if (localConstitution.outputSchema && localConstitution.outputSchema !== 'json') {
    violations.push('局部宪法试图修改输出格式为非 JSON');
  }

  // 检查是否有 forbidden 条款被覆盖
  ROOT_CONSTITUTION.forEach((article) => {
    if (article.overridable !== 'forbidden') return;
    const localOverrideKey = `article${article.number}`;
    if (localConstitution[localOverrideKey] !== undefined) {
      violations.push(
        `禁止覆盖条款 ${article.number}「${article.title}」(overridable=forbidden)`
      );
    }
  });

  return { valid: violations.length === 0, violations };
}

/**
 * 判断某条款是否可被子宪法覆盖。
 * @param {number} articleNumber - 条款编号 (1-7)
 * @returns {'forbidden'|'extensible_only'|'allowed'}
 */
export function getOverridable(articleNumber) {
  const article = ROOT_CONSTITUTION.find((a) => a.number === articleNumber);
  if (!article) return 'forbidden';
  return article.overridable;
}

/**
 * 获取可调参数的当前有效值。
 * 委托给 tunables 模块。
 *
 * @param {string} name - 参数名
 * @returns {number|string}
 */
export { getTunable } from './tunables.js';

/**
 * 导出 TUNABLES（14 参数定义）供外部引用。
 */
export { TUNABLES } from './tunables.js';

export default ROOT_CONSTITUTION;
