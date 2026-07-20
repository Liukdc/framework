// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 工具注册表 — 富贵小安 v5.8
 *
 * v5.5 工具分层发现:
 *   必用工具(required): 环节宪法 @section tools 声明,完整定义自动注入
 *   选用工具(catalog): @section tool_catalog 轻量级目录,按需加载
 *   search_tools: meta-tool 始终可用
 *
 * v5.4 tool calling: IN_SESSION 内调用DET工具(function calling)
 * EXECUTING 仅保留写入/删除,查询/对比在IN_SESSION内完成
 *
 * @module fugui-xiaoan/tool-registry
 */

import { getTunable } from './tunables.js';

// ═══ 必用工具完整定义 ═══════════════════

const REQUIRED_TOOLS = Object.freeze({
  insert_record: {
    name: 'insert_record',
    description: '新增一条消费记录',
    contractIn: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '种类,用户原话' },
        amount:   { type: 'number', description: '金额' },
        date:     { type: 'string', description: '日期 YYYY-MM-DD' },
        quantity: { type: 'number', description: '数量,默认1' },
        unit:     { type: 'string', description: '单位,默认null' },
      },
      required: ['category', 'amount', 'date'],
    },
    contractOut: {
      success: true,
      recordId: 'number',
    },
  },

  query_records: {
    name: 'query_records',
    description: '查询消费记录',
    contractIn: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
        endDate:   { type: 'string', description: '结束日期 YYYY-MM-DD' },
        category:  { type: 'string', description: '种类过滤' },
        minAmount: { type: 'number', description: '最低金额' },
        maxAmount: { type: 'number', description: '最高金额' },
      },
      required: [],
    },
    contractOut: {
      records: 'Array<{id,category,amount,date,quantity,unit}>',
      total: 'number',
    },
  },

  delete_record: {
    name: 'delete_record',
    description: '删除一笔消费记录',
    contractIn: {
      type: 'object',
      properties: {
        recordId: { type: 'number', description: '要删除的记录ID' },
      },
      required: ['recordId'],
    },
    contractOut: {
      success: true,
      deletedRecord: '{ category, amount, date }',
    },
  },

  query_total: {
    name: 'query_total',
    description: '查询指定时间范围的支出总额',
    contractIn: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', description: '时段(this_month/last_month/YYYY-MM),DET内部时间解析' },
      },
      required: ['timeRange'],
    },
    contractOut: {
      total: 'number',
    },
  },

  query_unit_price: {
    name: 'query_unit_price',
    description: '查询指定物品在指定时间的单价',
    contractIn: {
      type: 'object',
      properties: {
        item: { type: 'string', description: '物品名' },
        date: { type: 'string', description: '日期(yesterday/today),DET内部时间解析' },
      },
      required: ['item', 'date'],
    },
    contractOut: {
      unitPrice: 'number (amount ÷ quantity)',
      unit: 'string',
      amount: 'number',
      quantity: 'number',
    },
  },
});

// ═══ 选用工具轻量级目录 ═══════════════════

const CATALOG_TOOLS = Object.freeze({
  get_current_date: {
    name: 'get_current_date',
    description: '获取当前日期',
  },
  format_currency: {
    name: 'format_currency',
    description: '格式化金额显示',
  },
  calculate_percentage: {
    name: 'calculate_percentage',
    description: '计算百分比变化',
  },
  query_records: {
    name: 'query_records',
    description: '查询明细记录(定位用)',
  },
});

// ═══ meta-tool: search_tools ═══════════════

const META_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'search_tools',
    description: '搜索系统工具库中可用的工具。当你需要某个能力但当前工具列表中没有时,先调用此工具查找。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '需要的能力描述,如"当前日期""格式化金额"' },
      },
      required: ['query'],
    },
  },
});

// ═══ 各环节工具分配 ═══════════════════════

const TOOL_ASSIGNMENT = Object.freeze({
  record:  { required: ['insert_record'],                                    catalog: ['format_currency'] },
  query:   { required: ['query_records'],                                    catalog: ['get_current_date', 'format_currency'] },
  delete:  { required: ['delete_record'],                                    catalog: ['query_records'] },
  compare: { required: ['query_total', 'query_unit_price'],                  catalog: ['get_current_date', 'calculate_percentage', 'format_currency'] },
  other:   { required: [],                                                   catalog: [] },
  SLACK_NODE: { required: [],                                                catalog: [] },
});

// ═══ 工具注册表类 ═════════════════════════

export class ToolRegistry {
  constructor(contractStore) {
    this.contractStore = contractStore;
  }

  /**
   * 获取环节的工具完整定义(必用) + 轻量级目录(选用) + search_tools
   * @param {string} intent - 环节intent(record/query/delete/compare/other/SLACK_NODE)
   * @returns {{ tools: Array, catalog: Array, metaTool: Object }}
   */
  getToolsForIntent(intent) {
    const assignment = TOOL_ASSIGNMENT[intent] || { required: [], catalog: [] };

    const tools = assignment.required
      .map(name => REQUIRED_TOOLS[name])
      .filter(Boolean)
      .map(t => ({ type: 'function', function: t }));

    const catalog = assignment.catalog
      .map(name => CATALOG_TOOLS[name])
      .filter(Boolean);

    return { tools, catalog, metaTool: META_TOOL };
  }

  /**
   * 按名称加载选用工具的完整定义
   * @param {string[]} toolNames
   * @returns {Array}
   */
  loadCatalogTools(toolNames) {
    return toolNames
      .filter(name => REQUIRED_TOOLS[name])
      .map(name => ({ type: 'function', function: REQUIRED_TOOLS[name] }));
  }

  /**
   * search_tools 实现: 从选用工具库检索匹配
   * @param {string} query
   * @returns {{ tools: Array }}
   */
  searchTools(query) {
    const q = query.toLowerCase();
    const matched = Object.values(CATALOG_TOOLS)
      .filter(t => t.name.toLowerCase().includes(q) || t.description.includes(q))
      .map(t => ({ name: t.name, description: t.description }));

    return { tools: matched };
  }

  /**
   * 执行工具(DET确定性操作)
   * @param {string} toolName
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeTool(toolName, params) {
    switch (toolName) {
      case 'insert_record':
        return this.contractStore.insertRecord(params);
      case 'query_records':
        return this.contractStore.queryRecords(params);
      case 'delete_record':
        return this.contractStore.deleteRecord(params);
      case 'query_total':
        return this.contractStore.queryTotal(this.parseTimeRange(params.timeRange));
      case 'query_unit_price':
        return this.contractStore.queryUnitPrice(params.item, this.parseDate(params.date));
      case 'get_current_date': {
        const now = new Date();
        return { date: now.toISOString().split('T')[0], month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` };
      }
      case 'format_currency':
        return { formatted: `${Number(params.amount).toLocaleString('zh-CN')}元` };
      case 'calculate_percentage': {
        const diff = params.newValue - params.oldValue;
        const pct = params.oldValue !== 0 ? ((diff / params.oldValue) * 100).toFixed(1) + '%' : 'N/A';
        return { diff, percentage: pct };
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  // ═══ 时间解析(DET内部) ═══════════════════
  parseTimeRange(range) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (range) {
      case 'this_month':
        return { start: `${y}-${String(m+1).padStart(2,'0')}-01`, end: now.toISOString().split('T')[0] };
      case 'last_month':
        return { start: `${y}-${String(m).padStart(2,'0')}-01`, end: `${y}-${String(m+1).padStart(2,'0')}-01` };
      default:
        if (/^\d{4}-\d{2}$/.test(range)) {
          return { start: `${range}-01`, end: `${range}-31` };
        }
        return { start: range, end: range };
    }
  }

  parseDate(date) {
    const now = new Date();
    switch (date) {
      case 'yesterday': {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
      }
      case 'today':
        return now.toISOString().split('T')[0];
      default:
        return date;
    }
  }
}
