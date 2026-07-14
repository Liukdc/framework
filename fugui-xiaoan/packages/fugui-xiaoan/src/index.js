// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 — 主入口
 * 
 * 将所有模块组装为一个统一接口。
 * 使用方只需创建一个 FuguiXiaoan 实例，即可获得完整的记账+查询能力。
 * 
 * @module fugui-xiaoan
 * 
 * @example
 * import { FuguiXiaoan, createMemoryStorage } from 'fugui-xiaoan';
 * 
 * const storage = createMemoryStorage();
 * const xiaoan = new FuguiXiaoan({ storage });
 * 
 * const result = await xiaoan.record('午饭25块');
 * console.log(result.message); // "已记录：午饭 25元"
 * 
 * const query = await xiaoan.query('这个月花了多少');
 * console.log(query.message); // "本月共 N 笔，合计 ¥XXX"
 */

import { parse } from './parser.js';
import { createClarifyContext } from './clarify.js';
import { ClarifyState } from './types.js';
import { createMemoryStorage, MemoryStorage } from './storage.js';
import { executeQuery } from './query.js';
import { comparePrice } from './price-compare.js';
import { expandKeyword, initSynonyms } from './synonyms.js';
import { parseTimeRange } from './query-time.js';
import { classifyQuerySub, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from './intent-router.js';

/**
 * 主控制器
 */
export class FuguiXiaoan {
  /**
   * @param {Object} options
   * @param {import('./storage.js').StorageBackend} [options.storage] - 存储后端，默认内存存储
   * @param {Object} [options.customSynonyms] - 自定义同义词
   */
  constructor(options = {}) {
    this.storage = options.storage || createMemoryStorage();
    this._clarify = createClarifyContext();
    this._pendingClarifyId = null;
    this.mode = options.mode === 'detailed' ? 'detailed' : 'simple';  // 默认简单

    // 初始化同义词
    initSynonyms(options.customSynonyms);
  }

  /**
   * 获取当前记账模式
   * @returns {'simple'|'detailed'}
   */
  getMode() { return this.mode; }

  /**
   * 设置记账模式
   * @param {'simple'|'detailed'} mode
   */
  setMode(mode) { this.mode = mode === 'detailed' ? 'detailed' : 'simple'; }

  /**
   * 获取模式的中文标签
   * @returns {string}
   */
  getModeLabel() { return this.mode === 'detailed' ? '细致' : '简单'; }

  /**
   * 获取模式对应的主题色
   * @returns {string}
   */
  getModeColor() { return this.mode === 'detailed' ? '#14B8A6' : '#E8A840'; }

  /**
   * 记录一笔消费（或处理追问回复）
   * @param {string} text - 用户输入
   * @returns {Promise<Object>} 处理结果
   */
  async record(text) {
    const trimmed = text.trim();
    
    // ── 情况1: 正在追问中，这是用户的回复 ──
    if (this._pendingClarifyId) {
      // ── 分支A: 数量追问（_pendingClarifyId 是真实 record.id） ──
      if (this._pendingClarifyId !== 'pending') {
        const recordId = this._pendingClarifyId;
        const parsed = parse(trimmed);
        const best = parsed[0];
        if (best && (best.quantity || best.unit)) {
          // 查找已有记录
          const all = await this.storage.all();
          const existing = all.find(r => r.id === recordId);
          if (existing) {
            // 更新：删旧存新
            await this.storage.remove(recordId);
            const updated = await this.storage.save({
              text: existing.text,
              item: existing.item,
              amount: existing.amount,
              quantity: best.quantity || existing.quantity,
              unit: best.unit || existing.unit,
              unitPrice: best.unitPrice || existing.unitPrice,
              createdAt: existing.createdAt,
            });
            this._pendingClarifyId = null;

            let message = `已补全：${updated.item} ${updated.amount}元`;
            if (updated.quantity && updated.unit) {
              message += `（${updated.quantity}${updated.unit}`;
              if (updated.unitPrice) message += `，单价${updated.unitPrice}元/${updated.unit}`;
              message += '）';
            }
            return { type: 'confirm', message, record: updated };
          }
        }
        // 解析不到数量/单位，放弃追问
        this._pendingClarifyId = null;
      }

      // ── 分支B: 金额追问（_pendingClarifyId === 'pending'） ──
      const state = this._clarify.getState(this._pendingClarifyId);

      // 超时检测：2分钟未回复自动取消追问
      if (state === ClarifyState.ABANDONED) {
        this._clarify.clear(this._pendingClarifyId);
        this._pendingClarifyId = null;
        // 继续处理新输入（不返回超时消息，让用户无缝继续）
      } else if (state === ClarifyState.ASKED) {
        const parsed = parse(trimmed);
        const hasAmount = parsed.some(p => p.amount !== null);
        
        if (hasAmount) {
          this._clarify.handleReply(this._pendingClarifyId);
          const best = parsed[0];
          const record = await this.storage.save({
            text: trimmed,
            item: best.item,
            amount: best.amount || 0,
            quantity: best.quantity,
            unit: best.unit,
            unitPrice: best.unitPrice,
          });
          
          this._pendingClarifyId = null;
          
          let message = `已补全：${record.item} ${record.amount}元`;
          if (record.unitPrice) message += `（单价${record.unitPrice}元/${record.unit}）`;
          
          return { type: 'confirm', message, record };
        }
      }
      // 追问已失效（超时或被新输入打断）
      this._clarify.clear(this._pendingClarifyId);
      this._pendingClarifyId = null;
    }
    
    // ── 情况2: 判断是查询还是记账 ──
    const isQuery = /多[少錢钱]|花了?多|用了?多|总共|合计|汇总|统计|比.*[贵便宜涨跌]|对比/.test(trimmed);
    
    if (isQuery) {
      return this.query(trimmed);
    }
    
    // ── 情况3: 记账 ──
    const parsed = parse(trimmed);
    if (parsed.length === 0 || parsed.every(p => p.amount === null && p.item === '未指定项目')) {
      return { type: 'error', message: '没太明白，试试说「午饭25块」或问「这个月花了多少」？' };
    }
    
    // 保存所有有效记录
    const saved = [];
    
    for (const p of parsed) {
      if (p.amount === null) {
        // 信息不完整，发起追问
        const clarifyResult = this._clarify.checkAndAsk('pending', p.originalText);
        this._pendingClarifyId = 'pending';
        return {
          type: 'clarify',
          message: clarifyResult.question,
          partial: p,
        };
      }
      
      const record = await this.storage.save({
        text: p.originalText,
        item: p.item,
        amount: p.amount,
        quantity: p.quantity,
        unit: p.unit,
        unitPrice: p.unitPrice,
      });
      
      // 价格对比
      let comparison = null;
      if (p.unitPrice && p.unit) {
        comparison = await comparePrice(p.item, p.unitPrice, p.unit, this.storage);
      }
      
      saved.push({ record, comparison });
    }
    
    // 构建回复
    if (saved.length === 1) {
      const { record, comparison } = saved[0];

      // ── 细致模式：金额已有但缺数量 → 追问数量 ──
      if (this.mode === 'detailed' && !record.quantity && !record.unit) {
        this._pendingClarifyId = record.id; // 用真实 record.id 标记数量追问
        return {
          type: 'clarify',
          message: `已记录：${record.item} ${record.amount}元。买了多少呢？多少斤/个/件呢？（只问这一次~）`,
          record,
          comparison,
          needQuantity: true,
        };
      }

      let message = `已记录：${record.item} ${record.amount}元`;
      if (record.unitPrice) message += `（单价${record.unitPrice}元/${record.unit}）`;
      if (comparison?.trend !== 'new' && comparison?.description) {
        message += `\n${comparison.description}`;
      }
      return { type: 'confirm', message, record, comparison };
    }
    
    const total = saved.reduce((s, r) => s + r.record.amount, 0);
    return {
      type: 'confirm',
      message: `已记录 ${saved.length} 笔消费，共 ${total} 元`,
      records: saved.map(s => s.record),
    };
  }

  /**
   * 直接存结构化字段（跳过 parse，由对话引擎调用）
   * @param {Object} fields - { category, amount, time, quantity, unit }
   * @returns {Promise<Object>} 保存结果
   */
  async saveRecord(fields) {
    const record = await this.storage.save({
      text: `${fields.time || '今天'} ${fields.category} ${fields.amount}`,
      item: fields.category,
      amount: fields.amount,
      quantity: fields.quantity || 1,
      unit: fields.unit || '',
      unitPrice: fields.unitPrice || null,
    });
    return { type: 'confirm', message: `已记录：${fields.category} ${fields.amount}元`, record };
  }

  /**
   * 查询消费记录（接入意图路由器第二层分类）
   * @param {string} text - 查询文本
   * @returns {Promise<Object>}
   */
  async query(text) {
    const sub = classifyQuerySub(text);

    // 中置信度：返回确认提示
    if (sub.confidence >= CONFIDENCE_MEDIUM && sub.confidence < CONFIDENCE_HIGH) {
      return { type: 'clarify', message: sub.question || '您能再说得具体一点吗？' };
    }

    // 低置信度：返回引导
    if (sub.confidence < CONFIDENCE_MEDIUM) {
      return { type: 'result', message: sub.question || '您可以试试说「这个月花了多少」来查询消费记录~' };
    }

    // 高置信度：按子意图路由
    switch (sub.subIntent) {
      case 'single':  return this._singleQuery(text);
      case 'summary': return this._summaryQuery(text);
      case 'compare': return this._compareQuery(text);
      case 'fuzzy':   return this._fuzzyQuery(text);
      default:        return this._singleQuery(text);
    }
  }

  /**
   * 单笔查询（现有逻辑：按时间+关键词匹配）
   * @param {string} text
   * @returns {Promise<Object>}
   */
  async _singleQuery(text) {
    const result = await executeQuery(text, this.storage, {
      expandKeyword,
    });

    if (result.records.length === 0) {
      return { type: 'result', message: '没有找到相关消费记录。', result };
    }

    const timeLabel = result.dateRange.start
      ? `${new Date(result.dateRange.start).toLocaleDateString('zh-CN')} - ${new Date(result.dateRange.end).toLocaleDateString('zh-CN')}`
      : '全部时间';

    return {
      type: 'result',
      message: `${timeLabel} 共 ${result.records.length} 笔，合计 ${result.total.toFixed(2)} 元`,
      result,
    };
  }

  /**
   * 汇总查询：按时间段+种类聚合
   * @param {string} text
   * @returns {Promise<Object>}
   */
  async _summaryQuery(text) {
    const timeRange = parseTimeRange(text);
    const keyword = text
      .replace(/这个月|上个月|这周|上周|今天|昨天|花了?多[少錢钱]|用了?多[少錢钱]|总共|合计|一共|多少|花了|用了|汇总|统计/g, '')
      .trim();

    const results = await this.storage.query({
      startDate: timeRange?.start,
      endDate: timeRange?.end,
      keyword: keyword || undefined,
      limit: 500,
    });

    if (results.length === 0) {
      const timeLabel = timeRange
        ? `${new Date(timeRange.start).toLocaleDateString('zh-CN')} - ${new Date(timeRange.end).toLocaleDateString('zh-CN')}`
        : '全部时间';
      return { type: 'result', message: `${timeLabel} 没有找到${keyword ? '「' + keyword + '」相关' : ''}消费记录。` };
    }

    const total = results.reduce((s, r) => s + r.amount, 0);
    const timeLabel = timeRange
      ? `${new Date(timeRange.start).toLocaleDateString('zh-CN')} - ${new Date(timeRange.end).toLocaleDateString('zh-CN')}`
      : '全部时间';

    let message = `${timeLabel}`;
    if (keyword) message += `「${keyword}」`;
    message += `共 ${results.length} 笔，合计 ${total.toFixed(2)} 元`;

    return {
      type: 'result',
      message,
      result: {
        records: results,
        total,
        dateRange: timeRange || { start: null, end: null },
        queryType: 'summary',
      },
    };
  }

  /**
   * 对比查询：两组时间段对比均价/总额
   * @param {string} text
   * @returns {Promise<Object>}
   */
  async _compareQuery(text) {
    // 提取种类关键词
    const keyword = text
      .replace(/这个月|上个月|这周|上周|前天|今天|昨天|比|对比|贵了|便宜了|涨了|跌了|均价|价格|多少|元|块/g, '')
      .trim();

    // 解析本月数据
    const thisMonth = parseTimeRange('这个月' + (keyword ? ' ' + keyword : ''));
    const thisMonthResults = await this.storage.query({
      startDate: thisMonth?.start,
      endDate: thisMonth?.end,
      keyword: keyword || undefined,
      limit: 500,
    });

    // 解析上月数据
    const lastMonth = parseTimeRange('上个月' + (keyword ? ' ' + keyword : ''));
    const lastMonthResults = await this.storage.query({
      startDate: lastMonth?.start,
      endDate: lastMonth?.end,
      keyword: keyword || undefined,
      limit: 500,
    });

    const thisTotal = thisMonthResults.reduce((s, r) => s + r.amount, 0);
    const thisCount = thisMonthResults.length;

    const lastTotal = lastMonthResults.reduce((s, r) => s + r.amount, 0);
    const lastCount = lastMonthResults.length;

    // 计算均价（从有单价的记录中）
    const thisWithPrice = thisMonthResults.filter(r => r.unitPrice);
    const lastWithPrice = lastMonthResults.filter(r => r.unitPrice);

    const thisAvgPrice = thisWithPrice.length > 0
      ? thisWithPrice.reduce((s, r) => s + r.unitPrice, 0) / thisWithPrice.length
      : null;
    const lastAvgPrice = lastWithPrice.length > 0
      ? lastWithPrice.reduce((s, r) => s + r.unitPrice, 0) / lastWithPrice.length
      : null;

    // 获取单位
    const unit = thisWithPrice[0]?.unit || lastWithPrice[0]?.unit || '';

    let message;
    if (keyword) {
      message = `「${keyword}」`;
    } else {
      message = '消费';
    }

    if (thisAvgPrice && lastAvgPrice && unit) {
      const diff = thisAvgPrice - lastAvgPrice;
      const trend = diff > 0 ? '涨了' : diff < 0 ? '降了' : '持平';
      const diffAbs = Math.abs(diff).toFixed(2);
      message += `本月均价${thisAvgPrice.toFixed(2)}元/${unit}，上月${lastAvgPrice.toFixed(2)}元/${unit}`;
      if (diff !== 0) {
        message += `，${trend}${diffAbs}元/${unit}`;
      } else {
        message += '，价格持平';
      }
    } else {
      message += `本月${thisCount}笔共${thisTotal.toFixed(2)}元，上月${lastCount}笔共${lastTotal.toFixed(2)}元`;
      if (lastTotal > 0) {
        const totalDiff = thisTotal - lastTotal;
        const totalTrend = totalDiff > 0 ? '多花了' : totalDiff < 0 ? '少花了' : '持平';
        if (totalDiff !== 0) {
          message += `，${totalTrend}${Math.abs(totalDiff).toFixed(2)}元`;
        }
      }
    }

    return {
      type: 'result',
      message,
      result: {
        records: [...thisMonthResults, ...lastMonthResults],
        total: thisTotal,
        dateRange: thisMonth || { start: null, end: null },
        queryType: 'compare',
        comparison: {
          thisPeriod: { count: thisCount, total: thisTotal, avgPrice: thisAvgPrice },
          lastPeriod: { count: lastCount, total: lastTotal, avgPrice: lastAvgPrice },
        },
      },
    };
  }

  /**
   * 模糊查询：关键字匹配，返回最接近3-5条
   * @param {string} text
   * @returns {Promise<Object>}
   */
  async _fuzzyQuery(text) {
    const keyword = text
      .replace(/找一下|搜一下|随便|看看|查|有没有|帮我找/g, '')
      .trim();

    if (!keyword) {
      // 无关键词时返回最近5条
      const recent = await this.storage.query({ limit: 5 });
      return {
        type: 'result',
        message: recent.length > 0
          ? `找到 ${recent.length} 条最近记录`
          : '暂无消费记录',
        result: {
          records: recent,
          total: recent.reduce((s, r) => s + r.amount, 0),
          dateRange: { start: null, end: null },
          queryType: 'fuzzy',
        },
      };
    }

    // 先尝试同义词扩展
    let searchKeywords = [keyword];
    try {
      const expanded = expandKeyword(keyword);
      if (expanded && expanded.length > 0) {
        searchKeywords = expanded;
      }
    } catch { /* ignore */ }

    // 查询匹配记录
    const allResults = [];
    for (const kw of searchKeywords) {
      const records = await this.storage.query({
        keyword: kw,
        limit: 100,
      });
      for (const r of records) {
        if (!allResults.find(existing => existing.id === r.id)) {
          allResults.push(r);
        }
      }
    }

    // 按时间倒序，取前5条
    allResults.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const top5 = allResults.slice(0, 5);

    if (top5.length === 0) {
      return {
        type: 'result',
        message: `没有找到与「${keyword}」相关的消费记录。`,
        result: { records: [], total: 0, dateRange: { start: null, end: null }, queryType: 'fuzzy' },
      };
    }

    return {
      type: 'result',
      message: `找到 ${top5.length} 条与「${keyword}」相关的记录`,
      result: {
        records: top5,
        total: top5.reduce((s, r) => s + r.amount, 0),
        dateRange: { start: null, end: null },
        queryType: 'fuzzy',
      },
    };
  }

  /**
   * 删除一笔消费记录
   * @param {string} text - 用户输入（如"删掉昨天那笔午饭"）
   * @param {Object} [options]
   * @param {boolean} [options.confirmed] - 二次确认标记
   * @param {string} [options.targetId] - 指定删除的记录 ID（从多选列表中）
   * @returns {Promise<Object>}
   */
  async delete(text, options = {}) {
    // 1. 解析时间+种类
    const timeRange = parseTimeRange(text);
    const keyword = text
      .replace(/删掉?|去掉|不要了|取消|那笔|这笔/g, '')
      .replace(/\s+/g, '')
      .trim();

    // 2. 查找匹配记录
    const results = await this.storage.query({
      startDate: timeRange?.start,
      endDate: timeRange?.end,
      keyword: keyword || undefined,
      limit: 50,
    });

    // 3. 情况：无匹配
    if (results.length === 0) {
      return { type: 'result', message: '没有找到匹配的消费记录。' };
    }

    // 4. 情况：匹配多条 → 返回列表让用户选择
    if (results.length > 1 && !options.targetId) {
      return {
        type: 'clarify',
        message: `找到 ${results.length} 条匹配记录，请选择要删除的：`,
        records: results.map(r => ({
          id: r.id,
          item: r.item,
          amount: r.amount,
          date: new Date(r.createdAt).toLocaleDateString('zh-CN'),
        })),
      };
    }

    // 5. 情况：匹配1条（或已指定targetId）
    let targetRecord;
    if (options.targetId) {
      targetRecord = results.find(r => r.id === options.targetId);
      if (!targetRecord) {
        return { type: 'error', message: '未找到指定的记录。' };
      }
    } else {
      targetRecord = results[0];
    }

    // 6. 二次确认
    if (!options.confirmed) {
      return {
        type: 'clarify',
        message: `确认删除「${targetRecord.item}」${targetRecord.amount}元（${new Date(targetRecord.createdAt).toLocaleDateString('zh-CN')}）吗？请回复"确认"来执行删除。`,
        needConfirm: true,
        record: {
          id: targetRecord.id,
          item: targetRecord.item,
          amount: targetRecord.amount,
          date: new Date(targetRecord.createdAt).toLocaleDateString('zh-CN'),
        },
      };
    }

    // 7. 执行删除
    await this.storage.remove(targetRecord.id);
    return {
      type: 'confirm',
      message: `已删除「${targetRecord.item}」${targetRecord.amount}元`,
      deletedId: targetRecord.id,
    };
  }

  /**
   * 获取所有记录
   * @returns {Promise<Object[]>}
   */
  async getAllRecords() {
    return this.storage.all();
  }

  /**
   * 清空所有数据
   */
  async clearAll() {
    await this.storage.clear();
    this._pendingClarifyId = null;
  }
}

// ─── 具名导出 ────────────────────────────────────────

export { parse, parse as parseInput } from './parser.js';
export { createClarifyContext } from './clarify.js';
export { ClarifyState } from './types.js';
export { StorageBackend, MemoryStorage, LocalStorageStorage, EncryptedLocalStorage, createMemoryStorage, createLocalStorage, createEncryptedLocalStorage } from './storage.js';
export { executeQuery, detectQueryIntent } from './query.js';
export { parseTimeRange } from './query-time.js';
export { comparePrice } from './price-compare.js';
export { expandKeyword, initSynonyms, getAllGroups, addKeyword, removeKeyword } from './synonyms.js';
export { classifyIntent, classifyQuerySub, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from './intent-router.js';
export { toCSV, toJSON, download } from './export.js';
export { parseWithDeepSeek, getApiKey, setApiKey, clearApiKey } from './nlu.js';
export { CloudBaseStorage, createCloudBaseStorage } from './cloudbase-storage.js';
export { Scheduler, State as SchedulerState } from './state-machine.js';
export { ROOT_CONSTITUTION, validateAgainstRoot } from './root-constitution.js';
export { recordConstitution, buildRecordPrompt } from './constitution-record.js';
export { queryConstitution, deleteConstitution, exitConstitution, compareConstitution, otherConstitution,
  buildQueryPrompt, buildDeletePrompt, buildComparePrompt } from './constitution-sessions.js';
export { ContextManager } from './context-manager.js';
export { SessionStore } from './session-store.js';
export { identifyIntent, generateReply, hasApiKey } from './state-llm.js';
export { clarifyQuestion, tryParseField } from './clarify-templates.js';
export { TurnType, ChangeLevel, AskingField, isValidTurnType, isValidChangeLevel, isValidAskingField, validateTurn, createTurn } from './turnType.js';
export { getTunable, setTunable, resetTunables, getTunableDefs, getTunableSnapshot, detectConflicts, TUNABLES } from './tunables.js';

export default FuguiXiaoan;
