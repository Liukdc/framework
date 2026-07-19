// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 意图路由器 — 两层确定性规则引擎
 *
 * 不依赖 LLM，纯规则+评分体系实现意图分类。
 * 第一层：记账 / 查询 / 删除 / 其他
 * 第二层（仅查询）：单笔 / 汇总 / 对比 / 模糊
 *
 * @module fugui-xiaoan/intent-router
 */

// ─── 置信度阈值 ─────────────────────────────────────

/** 高置信度：≥80 直接执行 */
export const CONFIDENCE_HIGH = 80;

/** 中置信度：60-79 返回确认提示 */
export const CONFIDENCE_MEDIUM = 60;

// ─── 关键词语料 ─────────────────────────────────────

/** 记账关键词 */
const RECORD_KEYWORDS = ['记', '花了', '买了', '吃了', '付了', '用了', '花了', '消费'];

/** 查询关键词 */
const QUERY_KEYWORDS = ['查', '看', '多少', '花了多少', '汇总', '统计', '对比'];

/** 删除关键词 */
const DELETE_KEYWORDS = ['删', '去掉', '不要了', '取消'];

/** 查询-对比关键词 */
const COMPARE_KEYWORDS = ['比', '对比', '贵了', '便宜了', '涨了', '跌了'];

/** 汇总关键词 */
const SUMMARY_KEYWORDS = ['花了多少', '总共', '合计', '汇总', '统计', '花了多少'];

/** 模糊搜索关键词 */
const FUZZY_KEYWORDS = ['找一下', '搜一下', '随便', '看看'];

/** 时间词 */
const TIME_KEYWORDS = ['上月', '本月', '这周', '昨天', '今年'];

// ─── 工具 ───────────────────────────────────────────

/**
 * 统计文本中关键词命中次数
 * @param {string} text - 输入文本
 * @param {string[]} keywords - 关键词列表
 * @returns {number} 命中次数
 */
function countHits(text, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

/**
 * 计算置信度（0-100）
 * @param {number} score - 当前得分
 * @param {number} maxPossible - 可能满分
 * @returns {number}
 */
function calcConfidence(score, maxPossible) {
  if (maxPossible <= 0) return 0;
  return Math.min(100, Math.round((score / maxPossible) * 100));
}

/**
 * 根据置信度生成结果包装
 * @param {Object} result - { intent/subIntent, confidence }
 * @param {Object} sub - 子结果（可选）
 * @returns {Object}
 */
function wrapResult(result, sub = {}) {
  const base = { ...result, ...sub };

  if (base.confidence >= CONFIDENCE_HIGH) {
    return base;
  }

  if (base.confidence >= CONFIDENCE_MEDIUM) {
    base.needConfirm = true;
    base.question = buildConfirmQuestion(base);
    return base;
  }

  base.needGuide = true;
  base.question = buildGuideQuestion(base);
  return base;
}

/**
 * 构建确认提示（60-79 分）
 */
function buildConfirmQuestion(result) {
  if (result.intent === 'record') {
    return '您是要记一笔账吗？请告诉我买了什么、花了多少钱~';
  }
  if (result.intent === 'query') {
    return '您是想查询消费记录吗？请告诉我查询的时间范围或种类~';
  }
  if (result.intent === 'delete') {
    return '您是要删除某条消费记录吗？请确认一下~';
  }
  return '我不太确定您的意图，能再说得具体些吗？';
}

/**
 * 构建引导提示（<60 分）
 */
function buildGuideQuestion(result) {
  if (result.intent === 'record') {
    return '您好，我是记账助手。您可以这样说：「午饭25块」「买了三斤苹果45元」';
  }
  if (result.intent === 'query') {
    return '您好，查询可以这样说：「这个月花了多少」「排骨涨价了吗」';
  }
  if (result.intent === 'delete') {
    return '您好，删除可以说：「删掉昨天那笔午饭」';
  }
  return '您好！我是记账助手。可以记账（"午饭25块"）、查账（"这个月花了多少"），或删账。';
}

// ─── 第一层：主意图分类 ─────────────────────────────

/**
 * 分类用户输入的主意图（记账/查询/删除/其他）
 *
 * 规则体系（确定性规则引擎，不调LLM）：
 * - 记账关键词: 记|花了|买了|吃了|付了|用了|花了|消费 → 每个触发+15分
 * - 数量+金额模式(/[0-9]+块|[0-9]+元/) → +20分
 * - 查询关键词: 查|看|多少|花了多少|汇总|统计|对比|比.*[贵便宜涨跌] → 每个+15
 * - 时间词(上月|本月|这周|昨天|今年) + 无金额 → +20查询
 * - 删除关键词: 删|去掉|不要了|取消 → 每个+20
 * - 若四大类都<30 → 归类"其他"
 * - 置信度 = 匹配分/可能满分×100
 *
 * @param {string} text - 用户输入文本
 * @returns {{
 *   intent: 'record'|'query'|'delete'|'other',
 *   confidence: number,
 *   sub: Object,
 *   needConfirm?: boolean,
 *   question?: string,
 *   needGuide?: boolean,
 * }}
 */
export function classifyIntent(text) {
  if (!text || !text.trim()) {
    return {
      intent: 'other',
      confidence: 0,
      sub: {},
      needGuide: true,
      question: '请输入您想说的话~',
    };
  }

  const trimmed = text.trim();
  const hasAmount = /[0-9]+块|[0-9]+元|\d+(?:\.\d{1,2})?/.test(trimmed);
  const hasTime = TIME_KEYWORDS.some(kw => trimmed.includes(kw));

  // ── 计分 ──
  let recordScore = 0;
  let queryScore = 0;
  let deleteScore = 0;

  // 记账关键词 +15 每个
  recordScore += countHits(trimmed, RECORD_KEYWORDS) * 15;

  // 数量+金额模式 +20
  if (hasAmount && /[0-9]+块|[0-9]+元/.test(trimmed)) {
    recordScore += 20;
  }
  // 纯数字（无货币词但包含数字）也可能在记账
  if (hasAmount && !hasTime) {
    recordScore += 10;
  }

  // 查询关键词 +15 每个
  queryScore += countHits(trimmed, QUERY_KEYWORDS) * 15;

  // 时间词 + 无金额 → +20 查询
  if (hasTime && !hasAmount) {
    queryScore += 20;
  }

  // 对比关键词 +15 每个
  queryScore += countHits(trimmed, COMPARE_KEYWORDS) * 15;
  queryScore += countHits(trimmed, SUMMARY_KEYWORDS) * 15;

  // 删除关键词 +20 每个
  deleteScore += countHits(trimmed, DELETE_KEYWORDS) * 20;

  // ── 判定 ──
  const maxScore = Math.max(recordScore, queryScore, deleteScore, 0);

  if (maxScore < 30) {
    // 若含数字，偏向记账
    if (hasAmount && recordScore === maxScore) {
      return wrapResult({ intent: 'record', confidence: calcConfidence(recordScore, 100), sub: {} });
    }
    return wrapResult({ intent: 'other', confidence: calcConfidence(maxScore, 100), sub: {} });
  }

  if (recordScore === maxScore) {
    return wrapResult({ intent: 'record', confidence: calcConfidence(recordScore, 100), sub: {} });
  }
  if (queryScore === maxScore) {
    const querySub = classifyQuerySub(trimmed);
    return wrapResult(
      { intent: 'query', confidence: calcConfidence(queryScore, 100), sub: {} },
      { subIntent: querySub.subIntent, queryConfidence: querySub.confidence }
    );
  }
  if (deleteScore === maxScore) {
    return wrapResult({ intent: 'delete', confidence: calcConfidence(deleteScore, 100), sub: {} });
  }

  return wrapResult({ intent: 'other', confidence: calcConfidence(maxScore, 100), sub: {} });
}

// ─── 第二层：查询子意图分类 ─────────────────────────

/**
 * 分类查询子意图（单笔/汇总/对比/模糊）
 *
 * 规则：
 * - 单笔: 时间词+种类词+无汇总词 → 每个+25
 * - 汇总: 花了多少|总共|合计|汇总|统计|花了多少 → 每个+25
 * - 对比: 比|对比|贵了|便宜了|涨了|跌了 + 两组时间 → 每个+25
 * - 模糊: 找一下|搜一下|随便|看看 或 无明确时间/种类 → +20
 *
 * @param {string} text - 用户查询文本
 * @returns {{
 *   subIntent: 'single'|'summary'|'compare'|'fuzzy',
 *   confidence: number,
 *   needConfirm?: boolean,
 *   question?: string,
 *   needGuide?: boolean,
 * }}
 */
export function classifyQuerySub(text) {
  if (!text || !text.trim()) {
    return {
      subIntent: 'fuzzy',
      confidence: 0,
      needGuide: true,
      question: '请问您想查询什么？',
    };
  }

  const trimmed = text.trim();

  let singleScore = 0;
  let summaryScore = 0;
  let compareScore = 0;
  let fuzzyScore = 0;

  // 单笔：时间词+种类词+无汇总词 → 每个+25
  const hasTime = TIME_KEYWORDS.some(kw => trimmed.includes(kw));
  const hasSummary = SUMMARY_KEYWORDS.some(kw => trimmed.includes(kw));
  const hasCompare = COMPARE_KEYWORDS.some(kw => trimmed.includes(kw));
  const hasFuzzy = FUZZY_KEYWORDS.some(kw => trimmed.includes(kw));

  if (hasTime && !hasSummary && !hasCompare) {
    singleScore += 25;
  }

  // 如果有具体物品名，倾向于单笔
  if (!hasSummary && !hasCompare && !hasFuzzy && !hasTime) {
    singleScore += 20;
  }

  // 汇总：花了多少|总共|合计|汇总|统计|花了多少 → 每个+25
  summaryScore += countHits(trimmed, SUMMARY_KEYWORDS) * 25;

  // 对比：比|对比|贵了|便宜了|涨了|跌了 + 两组时间 → 每个+25
  compareScore += countHits(trimmed, COMPARE_KEYWORDS) * 25;

  // 模糊：找一下|搜一下|随便|看看 或 无明确时间/种类 → +20
  if (hasFuzzy) {
    fuzzyScore += 20;
  }

  // 无明确时间/种类且无其他特征 → 模糊
  if (!hasTime && !hasSummary && !hasCompare && !hasFuzzy && singleScore < 25) {
    fuzzyScore += 20;
  }

  // 总分上限估计值用于置信度
  const maxPossible = 100;

  const maxScore = Math.max(singleScore, summaryScore, compareScore, fuzzyScore);

  let subIntent, confidence;

  if (maxScore <= 0) {
    subIntent = 'fuzzy';
    confidence = 0;
  } else if (compareScore === maxScore) {
    subIntent = 'compare';
    confidence = calcConfidence(compareScore, maxPossible);
  } else if (summaryScore === maxScore) {
    subIntent = 'summary';
    confidence = calcConfidence(summaryScore, maxPossible);
  } else if (singleScore === maxScore) {
    subIntent = 'single';
    confidence = calcConfidence(singleScore, maxPossible);
  } else {
    subIntent = 'fuzzy';
    confidence = calcConfidence(fuzzyScore, maxPossible);
  }

  const result = { subIntent, confidence };

  if (confidence >= CONFIDENCE_HIGH) {
    return result;
  }

  if (confidence >= CONFIDENCE_MEDIUM) {
    result.needConfirm = true;
    result.question = buildSubConfirmQuestion(subIntent);
    return result;
  }

  result.needGuide = true;
  result.question = buildSubGuideQuestion(subIntent);
  return result;
}

/**
 * 子意图确认提示
 */
function buildSubConfirmQuestion(subIntent) {
  switch (subIntent) {
    case 'single':
      return '您是想查某一笔具体消费吗？请告诉我是哪一笔~';
    case 'summary':
      return '您是想看消费汇总吗？请告诉我时间范围~';
    case 'compare':
      return '您是想对比价格变化吗？请告诉我对比什么和时间~';
    case 'fuzzy':
      return '您能再说得详细一点吗？比如"本月午饭花了多少"~';
    default:
      return '能再说得具体一点吗？';
  }
}

/**
 * 子意图引导提示
 */
function buildSubGuideQuestion(subIntent) {
  switch (subIntent) {
    case 'single':
      return '您可以这样查单笔："昨天午饭花了多少"';
    case 'summary':
      return '您可以这样汇总："这个月一共花了多少"';
    case 'compare':
      return '您可以这样对比："排骨这个月和上月比涨了吗"';
    case 'fuzzy':
      return '您可以试试："找一下排骨"、"看看午饭"';
    default:
      return '您可以查询："这个月花了多少"';
  }
}

export default { classifyIntent, classifyQuerySub, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM };
