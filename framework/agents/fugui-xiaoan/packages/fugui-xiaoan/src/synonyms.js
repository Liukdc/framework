// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 同义词管理
 * 
 * 默认同义词库（7组80+关键词）+ 用户自定义扩展。
 * 支持关键词扩展：输入"交通" → 返回["交通","加油","打车","公交"...]
 * 
 * @module fugui-xiaoan/synonyms
 */

/** @type {Map<string, string[]>} */
const groups = new Map();

// ─── 默认词库 ────────────────────────────────────────

const DEFAULT_SYNONYMS = {
  "交通": ["加油", "打车", "公交", "地铁", "高铁", "火车", "飞机", "停车", "高速费", "过路费"],
  "餐饮": ["吃饭", "外卖", "买菜", "买肉", "买水果", "买零食", "买饮料", "下馆子", "请客", "食堂", "早饭", "午饭", "晚饭", "夜宵"],
  "日用": ["买衣服", "买鞋", "买包", "化妆品", "护肤品", "理发", "超市", "日用品", "洗漱", "纸巾", "洗衣"],
  "住房": ["房租", "水电费", "燃气费", "物业费", "网费", "话费"],
  "娱乐": ["电影", "唱歌", "旅游", "游戏", "健身", "买书", "会员", "门票", "奶茶", "咖啡"],
  "医疗": ["看病", "买药", "挂号", "体检", "牙科", "眼科"],
  "教育": ["培训", "课程", "书本", "文具", "考试费"],
};

/** @type {Map<string, string>} keyword → groupName 反向索引 */
const keywordToGroup = new Map();

/** 是否已初始化 */
let initialized = false;

/**
 * 初始化同义词库
 * @param {Object} [custom] - 自定义词库（与默认合并）
 */
export function initSynonyms(custom = {}) {
  if (initialized) return;
  
  const merged = { ...DEFAULT_SYNONYMS, ...custom };
  
  for (const [groupName, keywords] of Object.entries(merged)) {
    groups.set(groupName, [...keywords]);
    for (const kw of keywords) {
      keywordToGroup.set(kw, groupName);
    }
  }
  
  initialized = true;
}

/**
 * 扩展关键词（输入一个关键词，返回同组所有关键词）
 * @param {string} keyword - 输入关键词
 * @returns {string[]} 扩展后的关键词列表
 */
export function expandKeyword(keyword) {
  if (!initialized) initSynonyms();
  
  // 如果是分组名，返回该组所有关键词
  if (groups.has(keyword)) {
    return groups.get(keyword);
  }
  
  // 如果是个体关键词，返回同组所有关键词
  const groupName = keywordToGroup.get(keyword);
  if (groupName && groups.has(groupName)) {
    return groups.get(groupName);
  }
  
  // 未命中，返回自身
  return [keyword];
}

/**
 * 获取所有同义词分组
 * @returns {Array<{groupName: string, keywords: string[]}>}
 */
export function getAllGroups() {
  if (!initialized) initSynonyms();
  return [...groups.entries()].map(([groupName, keywords]) => ({
    groupName,
    keywords: [...keywords],
  }));
}

/**
 * 添加自定义关键词
 * @param {string} groupName - 分组名（新分组或已有分组）
 * @param {string} keyword - 要添加的关键词
 */
export function addKeyword(groupName, keyword) {
  if (!initialized) initSynonyms();
  
  if (!groups.has(groupName)) {
    groups.set(groupName, []);
  }
  
  const kwList = groups.get(groupName);
  if (!kwList.includes(keyword)) {
    kwList.push(keyword);
    keywordToGroup.set(keyword, groupName);
  }
}

/**
 * 删除关键词
 * @param {string} groupName - 分组名
 * @param {string} keyword - 要删除的关键词
 */
export function removeKeyword(groupName, keyword) {
  if (!groups.has(groupName)) return;
  
  const kwList = groups.get(groupName);
  const idx = kwList.indexOf(keyword);
  if (idx >= 0) {
    kwList.splice(idx, 1);
    keywordToGroup.delete(keyword);
  }
}

export default { initSynonyms, expandKeyword, getAllGroups, addKeyword, removeKeyword, DEFAULT_SYNONYMS };
