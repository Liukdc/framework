// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 环节内上下文拼接管理器 — 态控 v4.0 逻辑拼接图
 *
 * 调度器在 IN_SESSION 环节维护一个有向关联图，
 * 记录每一轮对话之间的逻辑依赖关系。
 * 每次模型需要生成回复前，调度器根据当前上下文图和历史记录，
 * 拼接出模型本次的输入。
 *
 * 核心机制：
 * 1. 双通道编排：保护态队列（硬门控） + 评分通道（语义匹配）
 * 2. @importance 分级截断：critical×2.0 / high×0.6 / normal×0.4
 * 3. 硬门控 fieldLevelHardGate：与当前追问存在逻辑依赖的历史轮次不会被淘汰
 * 4. bigram Jaccard 中文相似度评分 + 位置衰减
 * 5. Token 预算 70% 硬校验
 *
 * @module fugui-xiaoan/context-manager
 */

/** @typedef {{ role:'user'|'assistant'|'system', content:string, fields?:object, turnType?:string, time:number, importance?:string, room?:string }} TurnEntry */

// ═══ ContextManager ═══════════════════════

export class ContextManager {
  /**
   * @param {object} opts
   * @param {number} [opts.maxTurns=20] - 基础轮数上限 (turnHistory_limit)
   * @param {number} [opts.tokenBudget=3000] - Token 预算上限
   * @param {number} [opts.tokenBudgetRatio=0.7] - 预算使用比例（70% 硬校验）
   * @param {number} [opts.minMatchScore=0.3] - 最低匹配度阈值
   * @param {object} [opts.importanceMultipliers] - @importance 权重
   */
  constructor(opts = {}) {
    /** @type {TurnEntry[]} */
    this._turns = [];
    this._maxTurns = opts.maxTurns || 20;
    this._tokenBudget = opts.tokenBudget || 3000;
    this._tokenBudgetRatio = opts.tokenBudgetRatio || 0.7;
    this._minMatchScore = opts.minMatchScore || 0.3;

    // @importance 分级截断倍率
    this._importanceMultipliers = opts.importanceMultipliers || {
      critical: 2.0,  // critical × 2.0 = 40 轮（基于 maxTurns=20）
      high:     0.6,  // high × 0.6 = 12 轮
      normal:   0.4,  // normal × 0.4 = 8 轮
    };

    /** 硬门控：字段级受保护轮次索引（不会被淘汰） */
    this._protectedIndices = new Set();

    /** 当前环节的 room ID */
    this._currentRoom = null;

    /** 离线怀疑注入缓存 */
    this._offTaskSuspicions = [];
  }

  // ── 公开属性 ──────────────────────

  get turns() {
    return [...this._turns];
  }

  get protectedCount() {
    return this._protectedIndices.size;
  }

  // ── 核心接口 ──────────────────────

  /**
   * 添加一轮对话。
   *
   * @param {string} role - 'user' | 'assistant' | 'system'
   * @param {string} content - 对话内容
   * @param {object} [fields] - 关联字段
   * @param {string} [turnType] - turnType
   * @param {object} [opts]
   * @param {string} [opts.importance='normal'] - critical | high | normal
   * @param {string} [opts.room] - 所属 room ID
   */
  addTurn(role, content, fields, turnType, opts = {}) {
    const entry = {
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      fields: fields || undefined,
      turnType: turnType || undefined,
      time: Date.now(),
      importance: opts.importance || 'normal',
      room: opts.room || this._currentRoom,
    };
    this._turns.push(entry);

    // 根据 @importance 限制每个 room 的保留轮数
    this._trimByImportance();
  }

  // ═══ Appendix A.2: fieldLevelHardGate ═══════

  /**
   * 字段级硬门控保护。
   *
   * 将指定轮次标记为受保护，在上下文截断时优先保留。
   * 保护逻辑：与当前追问存在逻辑依赖的历史轮次不会被淘汰。
   *
   * @param {number} index - 要保护的轮次索引
   */
  fieldLevelHardGate(index) {
    if (index >= 0 && index < this._turns.length) {
      this._protectedIndices.add(index);
    }
  }

  /**
   * 自动标记逻辑依赖轮次为受保护。
   * 规则：validation_failed / ask / 高匹配度用户轮 → 受保护
   *
   * @param {number} index - 参考轮次索引
   */
  _autoGateDependents(index) {
    const turn = this._turns[index];
    if (!turn) return;

    // 标记自身
    if (
      turn.turnType === 'validation_failed' ||
      turn.turnType === 'ask' ||
      (turn.role === 'user' && turn.turnType !== 'off-task')
    ) {
      this._protectedIndices.add(index);
    }

    // 回溯：寻找逻辑前置轮次
    for (let i = index - 1; i >= Math.max(0, index - 5); i--) {
      const prev = this._turns[i];
      if (!prev) continue;
      // 同一 room 内的 ask → validation_failed 链
      if (
        prev.room === turn.room &&
        (prev.turnType === 'ask' || prev.turnType === 'validation_failed')
      ) {
        this._protectedIndices.add(i);
      }
    }
  }

  /**
   * 清除所有硬门控标记。
   */
  clearHardGates() {
    this._protectedIndices.clear();
  }

  // ═══ 注入离线怀疑 ═══════════════════

  /**
   * 注入离线任务偏离怀疑标记。
   * 在 DET 关键词扫描发现疑似偏离时调用。
   *
   * @param {{ userInput: string, offTaskSuspicion: string, time: number }} suspicion
   */
  injectOffTaskSuspicion(suspicion) {
    this._offTaskSuspicions.push(suspicion);
    // 保留最近 10 条怀疑记录
    if (this._offTaskSuspicions.length > 10) {
      this._offTaskSuspicions = this._offTaskSuspicions.slice(-10);
    }
  }

  // ═══ Appendix A.3: _scoreMatch bigram Jaccard ═══

  /**
   * 中文 bigram Jaccard 相似度计算。
   *
   * 将两段文本分别切分为 bigram 集合，
   * 计算 Jaccard 系数 = |A ∩ B| / |A ∪ B|。
   *
   * @param {string} textA - 文本 A
   * @param {string} textB - 文本 B
   * @returns {number} Jaccard 相似度 (0-1)
   */
  _scoreMatch(textA, textB) {
    if (!textA || !textB) return 0;

    const strA = typeof textA === 'string' ? textA : '';
    const strB = typeof textB === 'string' ? textB : '';

    if (strA.length === 0 || strB.length === 0) return 0;

    // 生成中文 bigram 集合
    const bigramsA = this._toBigramSet(strA);
    const bigramsB = this._toBigramSet(strB);

    if (bigramsA.size === 0 && bigramsB.size === 0) return 0;
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

    // Jaccard = |A ∩ B| / |A ∪ B|
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    const union = bigramsA.size + bigramsB.size - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * 将文本转换为 bigram 集合。
   * 中文按字符级 bigram，英文/数字保留原词边界。
   *
   * @param {string} text
   * @returns {Set<string>}
   */
  _toBigramSet(text) {
    const set = new Set();
    // 清理标点但保留中英文字符和数字
    const cleaned = text.replace(/[，。！？、,.;!?\s]+/g, '');
    if (cleaned.length === 0) return set;

    // 字符级 bigram
    for (let i = 0; i < cleaned.length - 1; i++) {
      set.add(cleaned.substring(i, i + 2));
    }
    // 单字也加入（处理单字符情况）
    if (cleaned.length === 1) {
      set.add(cleaned);
    }

    return set;
  }

  // ═══ 位置衰减 ═══════════════════════

  /**
   * 计算位置衰减系数。
   * positionDecay = 1.0 - (distance / turnHistory_limit)
   * 越远的轮次衰减越大。
   *
   * @param {number} distance - 距当前轮次的距离
   * @returns {number} 衰减系数 (0-1)
   */
  _positionDecay(distance) {
    return Math.max(0, 1.0 - distance / this._maxTurns);
  }

  // ═══ 双通道编排 ═══════════════════

  /**
   * 核心接口：拼接当前上下文，返回用于模型输入的结构化结果。
   *
   * 双通道编排：
   * 1. 保护态队列：硬门控受保护轮次 → 完整注入
   * 2. 评分通道：其余轮次按 bigram Jaccard × positionDecay 排序 → 择优注入
   *
   * @param {string} currentQuery - 当前用户输入
   * @param {object} collectedFields - 已采集字段
   * @param {object} [opts]
   * @param {number} [opts.maxTokens] - 覆盖 token 预算
   * @returns {{ context: string, turnsKept: number, estimatedTokens: number, protectedCount: number }}
   */
  buildPromptContext(currentQuery, collectedFields = {}, opts = {}) {
    const effectiveBudget = (opts.maxTokens || this._tokenBudget) * this._tokenBudgetRatio;
    const candidates = [];

    // ── 通道 1: 当前用户输入（始终注入） ──
    candidates.push({
      role: 'user',
      content: currentQuery || '',
      score: 1.0,
      channel: 'current',
      form: 'full',
    });

    // ── 通道 1: 已采集字段摘要（始终注入） ──
    const fieldSummary = Object.entries(collectedFields)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    if (fieldSummary) {
      candidates.push({
        role: 'system',
        content: `[已采集: ${fieldSummary}]`,
        score: 1.0,
        channel: 'current',
        form: 'summary',
      });
    }

    // ── 通道 1: 离线怀疑注入 ──
    if (this._offTaskSuspicions.length > 0) {
      const latestSuspicion = this._offTaskSuspicions[this._offTaskSuspicions.length - 1];
      candidates.push({
        role: 'system',
        content: `[偏离检测: ${latestSuspicion.offTaskSuspicion}]`,
        score: 0.9,
        channel: 'protected',
        form: 'anchor',
      });
    }

    // ── 通道分开处理：保护态 vs 评分 ──
    const protectedCandidates = [];
    const scoringCandidates = [];

    const recent = this._turns.slice(-this._maxTurns);
    for (let i = recent.length - 1; i >= 0; i--) {
      const turn = recent[i];
      const distance = recent.length - 1 - i;
      const posDecay = this._positionDecay(distance);
      const score = this._scoreMatch(turn.content, currentQuery || '') * posDecay;

      const isProtected = this._protectedIndices.has(
        this._turns.indexOf(turn)
      );

      const entry = {
        ...turn,
        score,
        distance,
        positionDecay: posDecay,
        protected: isProtected,
        index: i,
      };

      if (isProtected) {
        entry.form = 'full';
        entry.channel = 'protected';
        protectedCandidates.push(entry);
      } else if (score >= this._minMatchScore) {
        entry.channel = 'scoring';
        if (score > 0.6) {
          entry.form = 'full';
        } else if (score > 0.4) {
          entry.form = 'summary';
        } else {
          entry.form = 'anchor';
        }
        scoringCandidates.push(entry);
      }
      // 低于阈值：不注入
    }

    // ── 保护态队列：按时间顺序排列 ──
    protectedCandidates.sort((a, b) => a.index - b.index);

    // ── 评分通道：按 score 降序排列 ──
    scoringCandidates.sort((a, b) => b.score - a.score);

    // ── 合并：保护态在前，评分在后 ──
    const mergedCandidates = [...candidates, ...protectedCandidates, ...scoringCandidates];

    // ── Token 预算 70% 硬校验 ──
    const lines = [];
    let estimatedTokens = 0;
    const maxChars = Math.floor(effectiveBudget * 2); // 中文约 2 chars/token

    for (const c of mergedCandidates) {
      const label =
        c.role === 'user' ? '用户' : c.role === 'assistant' ? '小安' : '系统';
      let line;
      if (c.form === 'summary') {
        line = `[${label}摘要] ${c.content.slice(0, 80)}`;
      } else if (c.form === 'anchor') {
        line = `[${label}提及] ${c.content.slice(0, 40)}`;
      } else {
        line = `${label}: ${c.content}`;
      }

      const lineTokens = Math.ceil(line.length / 2);
      if (estimatedTokens + lineTokens > effectiveBudget) {
        // 预算耗尽，保护态不受影响（已经全部加入）
        if (c.channel === 'protected') continue;
        break;
      }
      lines.push(line);
      estimatedTokens += lineTokens;
    }

    const context = lines.join('\n');

    return {
      context,
      turnsKept: mergedCandidates.filter((c) => c.form && c.form !== 'removed').length,
      estimatedTokens,
      protectedCount: protectedCandidates.length,
    };
  }

  // ═══ 归档上下文 ═══════════════════

  /**
   * 归档当前上下文状态。
   * 在环节完成时调用，保留关键轮次，清理临时状态。
   *
   * @param {object} [opts]
   * @param {string} [opts.room] - 归档到指定 room
   * @param {boolean} [opts.keepProtected=true] - 是否保留保护态轮次
   * @returns {{ archivedCount: number, remainingCount: number }}
   */
  archiveContext(opts = {}) {
    const room = opts.room || this._currentRoom;
    const keepProtected = opts.keepProtected !== false;

    const archived = [];
    const remaining = [];

    for (let i = 0; i < this._turns.length; i++) {
      const turn = this._turns[i];
      const isProtected = this._protectedIndices.has(i);
      const isCritical = turn.importance === 'critical';

      if (keepProtected && (isProtected || isCritical)) {
        archived.push(turn);
      } else if (turn.importance === 'high' || turn.importance === 'critical') {
        archived.push(turn);
      } else {
        remaining.push(turn);
      }
    }

    this._turns = remaining;
    this._protectedIndices.clear();
    this._offTaskSuspicions = [];

    return {
      archivedCount: archived.length,
      remainingCount: remaining.length,
    };
  }

  // ═══ 内部方法 ═══════════════════════

  /**
   * 根据 @importance 分级截断。
   * critical: maxTurns × 2.0 轮
   * high: maxTurns × 0.6 轮
   * normal: maxTurns × 0.4 轮
   */
  _trimByImportance() {
    const criticalLimit = Math.floor(this._maxTurns * this._importanceMultipliers.critical);
    const highLimit = Math.floor(this._maxTurns * this._importanceMultipliers.high);
    const normalLimit = Math.floor(this._maxTurns * this._importanceMultipliers.normal);

    // 按 room 分组计数
    const roomCounts = {};
    const toRemove = new Set();

    for (let i = this._turns.length - 1; i >= 0; i--) {
      const turn = this._turns[i];
      if (this._protectedIndices.has(i)) continue; // 受保护不淘汰

      const room = turn.room || '__default__';
      if (!roomCounts[room]) {
        roomCounts[room] = { critical: 0, high: 0, normal: 0 };
      }

      const imp = turn.importance || 'normal';
      roomCounts[room][imp] = (roomCounts[room][imp] || 0) + 1;

      if (imp === 'critical' && roomCounts[room].critical > criticalLimit) {
        toRemove.add(i);
      } else if (imp === 'high' && roomCounts[room].high > highLimit) {
        toRemove.add(i);
      } else if (imp === 'normal' && roomCounts[room].normal > normalLimit) {
        toRemove.add(i);
      }
    }

    if (toRemove.size > 0) {
      this._turns = this._turns.filter((_, i) => !toRemove.has(i));
      // 重新映射 protected indices
      const newProtected = new Set();
      let offset = 0;
      for (let i = 0; i < this._turns.length + toRemove.size; i++) {
        if (toRemove.has(i)) {
          offset++;
          continue;
        }
        if (this._protectedIndices.has(i)) {
          newProtected.add(i - offset);
        }
      }
      this._protectedIndices = newProtected;
    }
  }

  /**
   * 设置当前 room。
   */
  setCurrentRoom(room) {
    this._currentRoom = room;
  }

  /**
   * 完全重置上下文管理器。
   */
  reset() {
    this._turns = [];
    this._protectedIndices.clear();
    this._offTaskSuspicions = [];
    this._currentRoom = null;
  }

  /**
   * 获取上下文状态快照（用于 schedulerState）。
   */
  getSnapshot() {
    return {
      totalTurns: this._turns.length,
      protectedCount: this._protectedIndices.size,
      offTaskSuspicions: this._offTaskSuspicions.length,
      currentRoom: this._currentRoom,
    };
  }
}

export default ContextManager;
