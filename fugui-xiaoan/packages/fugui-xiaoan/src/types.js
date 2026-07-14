// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 — 核心类型定义
 * 
 * 这是一个"反分类"记账系统。它的核心主张是：不将用户的消费映射到任何预定义类别，
 * 而是以原始自然语言文本存储，通过关键词匹配直接查询。
 * 
 * @module fugui-xiaoan/types
 */

/**
 * 追问状态枚举
 * @readonly
 * @enum {string}
 */
export const ClarifyState = Object.freeze({
  /** 待补全信息 */
  PENDING: 'PENDING',
  /** 已发出追问，等待用户回复 */
  ASKED: 'ASKED',
  /** 信息已完整 */
  NORMAL: 'NORMAL',
  /** 追问超时或用户放弃 */
  ABANDONED: 'ABANDONED',
});

/**
 * 一条消费记录
 * @typedef {Object} ExpenseRecord
 * @property {string}  id             - 唯一标识
 * @property {string}  text           - 用户原始输入文本
 * @property {string}  item           - 提取的项目描述
 * @property {number}  amount         - 金额
 * @property {number}  [quantity]     - 数量
 * @property {string}  [unit]         - 单位（斤/个/件等）
 * @property {number}  [unitPrice]    - 单价（自动计算）
 * @property {string}  clarifyState   - 追问状态
 * @property {string}  createdAt      - 创建时间 ISO 字符串
 */

/**
 * 解析结果
 * @typedef {Object} ParseResult
 * @property {string}       originalText  - 原始输入文本
 * @property {number|null}  amount        - 提取的金额
 * @property {string}       item          - 提取的项目描述
 * @property {number|null}  quantity      - 提取的数量
 * @property {string|null}  unit          - 提取的单位
 * @property {number|null}  unitPrice     - 自动计算的单价
 * @property {boolean}      isComplete    - 信息是否完整
 * @property {string[]}     needClarify   - 需要追问的字段列表
 */

/**
 * 查询结果
 * @typedef {Object} QueryResult
 * @property {ExpenseRecord[]}  records    - 匹配的记录列表
 * @property {number}           total      - 总额
 * @property {Object}           dateRange  - 时间范围 {start, end}
 * @property {string}           queryType  - 查询类型 'summary' | 'list' | 'compare'
 */

/**
 * 价格对比结果
 * @typedef {Object} ComparisonResult
 * @property {number|null}  currentPrice   - 本次单价
 * @property {number|null}  lastPrice      - 上次单价
 * @property {number|null}  changePercent  - 变化百分比
 * @property {string}       trend          - 'up' | 'down' | 'flat' | 'new'
 * @property {string|null}  description    - 人类可读的描述文本
 */

/**
 * 同义词数据结构
 * @typedef {Object} SynonymGroup
 * @property {number}    id          - 分组 ID
 * @property {string}    groupName   - 分组名称（如"交通"）
 * @property {string[]}  keywords    - 关键词列表
 * @property {boolean}   isCustom    - 是否用户自定义
 */

/** 空导出，仅作类型文档 */
export {};
