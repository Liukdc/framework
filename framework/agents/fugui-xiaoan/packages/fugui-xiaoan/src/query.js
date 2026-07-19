// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 自然语言查询引擎
 * 
 * 支持的时间修饰词：今天、昨天、这周、上周、这个月、上个月
 * 支持的同义词扩展：由 Synonyms 模块提供
 * 查询类型自动识别：汇总(summary)、列表(list)、对比(compare)
 * 
 * @module fugui-xiaoan/query
 */

import { parseTimeRange } from './query-time.js';
export { parseTimeRange };

/**
 * 检测查询意图
 * @param {string} text - 用户输入
 * @returns {'summary'|'list'|'compare'}
 */
export function detectQueryIntent(text) {
  if (/花了?多[少錢钱]|总共|合计|汇总|总结|统计/.test(text)) return 'summary';
  if (/对比|比较|涨|跌|比.*[贵便宜]/.test(text)) return 'compare';
  return 'list';
}

/**
 * 执行查询
 * @param {string} text - 用户查询文本
 * @param {import('./storage.js').StorageBackend} storage - 存储后端
 * @param {Object} [options]
 * @param {function(string): Promise<string[]>} [options.expandKeyword] - 同义词扩展函数
 * @returns {Promise<import('./types.js').QueryResult>}
 */
export async function executeQuery(text, storage, options = {}) {
  const { expandKeyword } = options;
  const intent = detectQueryIntent(text);
  const timeRange = parseTimeRange(text);
  
  // 提取查询关键词（移除时间修饰词和其他语气词）
  let keyword = text
    .replace(/这个月|上个月|这周|上周|今天|昨天|花了?多[少錢钱]|用了?多[少錢钱]|总共|合计|一共|多少|花了|用了|比|少了|多了|涨了|跌了|比上|比这|统计|汇总/g, '')
    .trim();
  
  // 同义词扩展
  let searchKeywords = keyword ? [keyword] : [''];
  if (keyword && expandKeyword) {
    try {
      const expanded = await expandKeyword(keyword);
      if (expanded && expanded.length > 0) {
        searchKeywords = expanded;
      }
    } catch { /* ignore synonym errors */ }
  }
  
  // 查询所有匹配的记录
  const allResults = [];
  for (const kw of searchKeywords) {
    const records = await storage.query({
      keyword: kw || undefined,
      startDate: timeRange?.start,
      endDate: timeRange?.end,
      limit: 200,
    });
    for (const r of records) {
      if (!allResults.find(existing => existing.id === r.id)) {
        allResults.push(r);
      }
    }
  }
  
  // 按时间倒序
  allResults.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  const total = allResults.reduce((sum, r) => sum + r.amount, 0);
  
  return {
    records: allResults,
    total,
    dateRange: timeRange || { start: null, end: null },
    queryType: intent,
  };
}

export default { executeQuery, detectQueryIntent, parseTimeRange };
