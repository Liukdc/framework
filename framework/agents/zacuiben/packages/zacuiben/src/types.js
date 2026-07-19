// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂粹本 — 核心类型定义
 *
 * 这是一个"反分类"碎片清理工具。核心理念：
 * 1. 记录时不分类 —— 原始自然语言存入
 * 2. 定时主动清理 —— 不堆积，不拖延
 * 3. 每条碎片都有归宿 —— 保留/删除/归档，三者必居其一
 *
 * @module zacuiben/types
 */

/**
 * 清理会话状态机
 * @readonly
 * @enum {string}
 */
export const SessionState = Object.freeze({
  /** 空闲，等待启动 */
  IDLE: 'idle',
  /** 清理进行中 */
  ACTIVE: 'active',
  /** 清理完成 */
  COMPLETED: 'completed',
});

/**
 * 碎片处理状态
 * @readonly
 * @enum {string}
 */
export const RecordStatus = Object.freeze({
  /** 待清理 */
  PENDING: 'pending',
  /** 已保留 */
  KEPT: 'kept',
  /** 已删除 */
  DELETED: 'deleted',
  /** 已归档 */
  ARCHIVED: 'archived',
  /** 已废弃（整理跳过≥3次 或 主动废弃） */
  ABANDONED: 'abandoned',
});

/**
 * 一条碎片记录
 * @typedef {Object} FragmentRecord
 * @property {string}  id          - 唯一标识
 * @property {string}  name        - 碎片名称（截取前20字）
 * @property {string}  content     - 碎片完整内容
 * @property {boolean} isProtected - 是否受保护（不可删除）
 * @property {'pending'|'kept'|'deleted'|'archived'|'abandoned'} status - 处理状态
 * @property {string}  createdAt   - 创建时间 ISO 字符串
 * @property {string}  updatedAt   - 最后更新时间 ISO 字符串
 * @property {boolean} [isTemporary] - 是否为临时 Key（无正式名称）
 * @property {number}  [skipCount]   - 整理跳过次数
 * @property {string|null} [organizeTime] - 整理时间 ISO 字符串，"never" 表示永不提醒
 * @property {Array<{type:string, path:string, size:number, createdAt:string}>} [attachments] - 附件列表
 */

/**
 * 决策动作
 * @typedef {'keep'|'delete'|'archive'} CleanupAction
 */

/**
 * 删除验证结果
 * @typedef {Object} DeleteVerification
 * @property {boolean} allowed - 是否允许删除
 * @property {string}  reason  - 不允许时的原因说明
 */

/**
 * 清理进度
 * @typedef {Object} CleanupProgress
 * @property {number} total     - 碎片总数
 * @property {number} current   - 当前进度（已处理数）
 * @property {number} kept      - 已保留数
 * @property {number} deleted   - 已删除数
 * @property {number} archived  - 已归档数
 * @property {number} remaining - 剩余待处理数
 */

/**
 * 统计信息
 * @typedef {Object} ZacuibenStats
 * @property {number} totalFragments    - 碎片总数
 * @property {number} pendingFragments  - 待清理碎片数
 * @property {number} keptFragments     - 保留碎片数
 * @property {number} deletedFragments  - 已删除碎片数
 * @property {number} archivedFragments - 已归档碎片数
 * @property {number} protectedFragments- 受保护碎片数
 * @property {number} abandonedFragments- 已废弃碎片数
 */

/** 空导出，仅作类型文档 */
export {};
