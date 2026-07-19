// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 价格对比服务
 * 
 * 自动计算单价，查找最近一次同品类购买记录，对比价格变化。
 * 
 * @module fugui-xiaoan/price-compare
 */

/**
 * 执行价格对比
 * @param {string} keyword - 查询关键词
 * @param {number} currentPrice - 本次单价
 * @param {string} unit - 单位
 * @param {import('./storage.js').StorageBackend} storage - 存储后端
 * @returns {Promise<import('./types.js').ComparisonResult>}
 */
export async function comparePrice(keyword, currentPrice, unit, storage) {
  const result = {
    currentPrice,
    lastPrice: null,
    changePercent: null,
    trend: 'new',
    description: null,
  };
  
  if (!storage) return result;
  
  try {
    const records = await storage.query({ keyword, limit: 50 });
    
    // 筛出有单价的记录
    const withPrice = records.filter(r => r.unitPrice && r.id);
    if (withPrice.length === 0) return result;
    
    // 找最近一条
    const last = withPrice.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!last || !last.unitPrice) return result;
    
    result.lastPrice = last.unitPrice;
    
    const daysAgo = Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 86400000);
    
    if (currentPrice > last.unitPrice) {
      result.trend = 'up';
      result.changePercent = Math.round(((currentPrice - last.unitPrice) / last.unitPrice) * 100);
    } else if (currentPrice < last.unitPrice) {
      result.trend = 'down';
      result.changePercent = Math.round(((last.unitPrice - currentPrice) / last.unitPrice) * 100);
    } else {
      result.trend = 'flat';
      result.changePercent = 0;
    }
    
    const trendLabel = result.trend === 'up' ? '涨了' : result.trend === 'down' ? '降了' : '持平';
    result.description = `上次${last.unitPrice}元/${unit}（${daysAgo}天前），本次${currentPrice}元/${unit}，${trendLabel}${result.changePercent > 0 ? result.changePercent + '%' : ''}`;
    
  } catch { /* ignore */ }
  
  return result;
}

export default { comparePrice };
