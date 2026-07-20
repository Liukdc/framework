// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * contractStore — 富贵小安 v5.8
 *
 * v5.7: roomConversationLog 分段保留(segmentType/relatedOutputId/summaryImportance/originalTurnRange)
 * v5.8: conversationArchive FTS5 全量文本备份(不参与拼接,仅供搜索)
 *
 * @module fugui-xiaoan/contract-store-v5.8
 */

import { getTunable, isColdStart } from './tunables.js';

export class InMemoryContractStore {
  constructor() {
    // ═══ 13 张表 ═══════════════════════
    this._records = [];              // 消费记录(业务数据,不属于contractStore但在此管理)
    this._analyzingIn = null;
    this._checkpoint = null;
    this._conversationLog = [];     // roomConversationLog (v5.7分段保留)
    this._conversationArchive = []; // v5.8 全量备份
    this._roomStateIndex = {};
    this._outputRegistry = [];
    this._domainRules = [];
    this._toolRegistry = {};
    this._projects = {};

    // ═══ 会话计数 ═══
    this._sessionIndex = 0;
    this._segmentMap = new Map();   // turnNumber → segmentType
  }

  // ═══ sessionCheckpoint ═══════════════════
  getCheckpoint(userId) {
    const cp = this._checkpoint;
    if (!cp) return null;
    const ttl = getTunable('session_checkpoint_ttl', 604800) * 1000;
    const isExpired = (Date.now() - cp.updatedAt) > ttl;
    if (isExpired) return null;
    return { ...cp, isExpired: () => false, lastCompletedStep: cp.step, completedSteps: [cp.step], stepSnapshots: cp.snapshot || {} };
  }

  saveCheckpoint(step, collectedFields) {
    this._checkpoint = { step, snapshot: { [step]: { collectedFields, timestamp: new Date().toISOString() } }, updatedAt: Date.now() };
  }

  // ═══ 消费记录 ═══════════════════════════
  insertRecord({ category, amount, date, quantity, unit }) {
    const record = { id: this._records.length + 1, category, amount: Number(amount), date: date || new Date().toISOString().split('T')[0], quantity: Number(quantity) || 1, unit: unit || null };
    this._records.push(record);
    this.saveCheckpoint('record', record);
    return { success: true, recordId: record.id };
  }

  queryRecords({ startDate, endDate, category, minAmount, maxAmount }) {
    let records = [...this._records];
    if (startDate) records = records.filter(r => r.date >= startDate);
    if (endDate) records = records.filter(r => r.date <= endDate);
    if (category) records = records.filter(r => r.category.includes(category));
    if (minAmount != null) records = records.filter(r => r.amount >= minAmount);
    if (maxAmount != null) records = records.filter(r => r.amount <= maxAmount);
    return { records, total: records.length };
  }

  deleteRecord(recordId) {
    const idx = this._records.findIndex(r => r.id === recordId);
    if (idx === -1) return { success: false, error: '记录不存在' };
    const deleted = this._records[idx];
    this._records.splice(idx, 1);
    return { success: true, deletedRecord: { category: deleted.category, amount: deleted.amount, date: deleted.date } };
  }

  queryTotal(startDate, endDate) {
    const records = this._records.filter(r => r.date >= startDate && r.date <= endDate);
    return { total: records.reduce((sum, r) => sum + r.amount, 0) };
  }

  queryUnitPrice(item, date) {
    const records = this._records.filter(r => r.category?.includes(item) && r.date === date);
    if (!records.length) return { unitPrice: 0, unit: '', amount: 0, quantity: 0 };
    const r = records[0];
    return { unitPrice: r.amount / Math.max(r.quantity, 1), unit: r.unit || '', amount: r.amount, quantity: r.quantity };
  }

  // ═══ roomConversationLog (v5.7 分段保留) ═══
  appendConversation(roomId, turnNumber, userMessage, modelOutput, turnType, askingField) {
    this._conversationLog.push({
      logId: `log_${Date.now()}_${turnNumber}`,
      roomId, turnNumber, userMessage, modelOutput, turnType, askingField,
      createdAt: new Date().toISOString(),
      segmentType: 'full',
      relatedOutputId: null,
      summaryImportance: null,
      originalTurnRange: null,
    });
  }

  /**
   * v5.7: 产出物确认后生成摘要
   * @param {string} roomId
   * @param {number[]} turnRange [startTurn, endTurn]
   * @param {string} summary - 模型生成的摘要文本
   * @param {string} outputId - 关联的产出物ID
   * @param {string} importance - 摘要重要性(critical/high/normal)
   */
  archiveAndSummarize(roomId, turnRange, summary, outputId, importance = 'normal') {
    const [startT, endT] = turnRange;
    const targets = this._conversationLog.filter(l => l.roomId === roomId && l.turnNumber >= startT && l.turnNumber <= endT);

    if (getTunable('conversation_archive_enabled', true)) {
      // v5.8: 原始对话移到 conversationArchive
      this._conversationArchive.push(...targets.map(t => ({
        ...t, archivedAt: new Date().toISOString(), relatedOutputId: outputId,
      })));
    }

    // 从 roomConversationLog 删除原始对话
    this._conversationLog = this._conversationLog.filter(l => !(l.roomId === roomId && l.turnNumber >= startT && l.turnNumber <= endT));

    // 写入摘要记录
    this._conversationLog.push({
      logId: `summary_${Date.now()}`,
      roomId, turnNumber: endT + 1,
      userMessage: null, modelOutput: summary,
      turnType: 'summary', askingField: null,
      createdAt: new Date().toISOString(),
      segmentType: 'summary',
      relatedOutputId: outputId,
      summaryImportance: importance,
      originalTurnRange: `${startT}-${endT}`,
    });

    // 按重要性清理旧摘要(FIFO)
    const limits = { critical: getTunable('summary_retention_critical', 10), high: getTunable('summary_retention_high', 5), normal: getTunable('summary_retention_normal', 2) };
    const summaries = this._conversationLog.filter(l => l.segmentType === 'summary' && l.summaryImportance === importance);
    const limit = limits[importance] || 2;
    while (summaries.length > limit) {
      const oldest = summaries.shift();
      this._conversationLog = this._conversationLog.filter(l => l.logId !== oldest.logId);
    }
  }

  // ═══ conversationArchive (v5.8 FTS5) ═════
  searchArchive(query) {
    if (!query?.trim()) return [];
    // FTS5-like: 支持空格分隔的多词搜索 + 通配符
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this._conversationArchive.filter(a => {
      const text = `${a.userMessage||''} ${a.modelOutput||''}`.toLowerCase();
      return terms.every(t => {
        if (t.endsWith('*')) return text.includes(t.slice(0,-1)); // 通配符
        return text.includes(t); // 精确匹配
      });
    }).map(a => ({
      archiveId: a.logId,
      roomId: a.roomId,
      turnNumber: a.turnNumber,
      userMessage: a.userMessage,
      modelOutput: a.modelOutput,
      createdAt: a.createdAt,
      archivedAt: a.archivedAt,
      // FTS5-like highlight
      snippet: this._highlight(a.userMessage || a.modelOutput || '', terms),
    }));
  }

  _highlight(text, terms) {
    let result = text.substring(0, 200);
    for (const t of terms) {
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\*$/,'')})`, 'gi');
      result = result.replace(re, '**$1**');
    }
    return result;
  }

  // ═══ 获取注入用对话 ═══════════════════════
  getConversationForInjection(roomId, limit = 20) {
    const full = this._conversationLog
      .filter(l => l.roomId === roomId && l.segmentType === 'full')
      .slice(-limit);
    const summaries = this._conversationLog
      .filter(l => l.roomId === roomId && l.segmentType === 'summary')
      .sort((a, b) => {
        const order = { critical: 0, high: 1, normal: 2 };
        return (order[a.summaryImportance] || 2) - (order[b.summaryImportance] || 2);
      });
    return { full, summaries };
  }

  // ═══ 会话计数 ═══════════════════════════
  getSessionIndex() { return this._sessionIndex; }
  incrementSession() { this._sessionIndex++; }
}
