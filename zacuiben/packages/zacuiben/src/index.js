// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂粹本 — 主入口
 *
 * 将所有模块组装为统一接口。
 * 使用方只需创建一个 Zacuiben 实例，即可获得完整的碎片记录+清理能力。
 *
 * @module zacuiben
 *
 * @example
 * import { Zacuiben, createMemoryStorage } from 'zacuiben';
 *
 * const storage = createMemoryStorage();
 * const zc = new Zacuiben({ storage });
 *
 * // 记录碎片
 * await zc.addFragment('看到一篇关于反分类的好文章');
 *
 * // 智能录入（支持召唤指令和 Key--Content 格式）
 * const result = zc.record('杂碎本，记一下，灵感——反分类是一种新思路');
 *
 * // 标记重要碎片
 * await zc.protectFragment('frag_001');
 *
 * // 开始清理
 * const session = await zc.startCleanup();
 * // 逐条决策
 * await session.decide('keep');
 * await session.decide('archive');
 *
 * // 查看统计
 * const stats = zc.getStats();
 */
import { createMemoryStorage, MemoryStorage } from './storage.js';
import { CleanupScheduler } from './scheduler.js';
import { CleanupSession } from './session.js';
import { ProtectionManager } from './protector.js';
import { SessionState, RecordStatus } from './types.js';
import { isValidKey } from './valid-key.js';

/**
 * 杂粹本主控制器
 */
export class Zacuiben {
  /**
   * @param {Object} options
   * @param {import('./storage.js').StorageBackend} [options.storage] — 存储后端，默认内存存储
   * @param {number} [options.cleanupIntervalMs] — 清理提醒间隔，默认 30 分钟
   * @param {Function} [options.onCleanupDue] — 清理到期回调
   */
  constructor(options = {}) {
    /** @type {import('./storage.js').StorageBackend} */
    this.storage = options.storage || createMemoryStorage();
    /** @type {ProtectionManager} */
    this._protector = new ProtectionManager(this.storage);
    /** @type {CleanupSession|null} */
    this._session = null;
    /** @type {CleanupScheduler} */
    this._scheduler = new CleanupScheduler({
      intervalMs: options.cleanupIntervalMs,
      onDue: options.onCleanupDue || (() => {}),
    });

    // ── v1.0 新增 ──
    /** 临时 Key 自增计数器 */
    this._tempKeyCounter = 0;
    /** 附件限制 */
    this._attachmentLimits = {
      maxCount: 5,
      maxSizeByType: {
        'image': 10 * 1024 * 1024,   // 10MB
        'video': 100 * 1024 * 1024,  // 100MB
        'audio': 50 * 1024 * 1024,   // 50MB
        'default': 50 * 1024 * 1024, // 默认 50MB
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  // 碎片管理（原有）
  // ═══════════════════════════════════════════════════════

  /**
   * 添加一条碎片
   * @param {string} content — 碎片内容
   * @returns {Promise<Object>} 保存后的完整记录
   */
  async addFragment(content) {
    if (!content || !content.trim()) {
      throw new Error('碎片内容不能为空');
    }
    return this.storage.save({ content: content.trim() });
  }

  /**
   * 获取所有碎片
   * @param {Object} [options]
   * @param {string} [options.status] — 按状态筛选
   * @returns {Promise<Object[]>}
   */
  async getAllFragments(options = {}) {
    const all = await this.storage.all();
    if (options.status) {
      return all.filter(r => r.status === options.status);
    }
    return all;
  }

  /**
   * 获取待清理的碎片列表
   * @returns {Promise<Object[]>}
   */
  async getPendingFragments() {
    return this.getAllFragments({ status: RecordStatus.PENDING });
  }

  // ═══════════════════════════════════════════════════════
  // v1.0 录入流程
  // ═══════════════════════════════════════════════════════

  /**
   * 智能录入碎片
   *
   * 支持三种录入模式：
   * 1. 召唤指令 "杂碎本，记一下" → 进入记录模式，后续文本为内容
   * 2. Key——Content 格式（全角/半角破折号分隔）→ 解析后分别作为名称和内容
   * 3. 纯文本无 Key → 自动生成 "临时-N" Key，标记 isTemporary=true
   *
   * @param {string} text — 用户输入的原始文本
   * @returns {{type:'record', name:string, content:string, isTemporary:boolean, id?:string}}
   */
  record(text) {
    if (!text || !text.trim()) {
      throw new Error('录入内容不能为空');
    }

    let working = text.trim();

    // 1. 解析召唤指令
    const summonPattern = /^杂碎本[，,]\s*记\s*一\s*下[。！!]?\s*/;
    if (summonPattern.test(working)) {
      working = working.replace(summonPattern, '').trim();
      if (!working) {
        throw new Error('召唤指令后缺少记录内容');
      }
    }

    // 2. 解析 Key——Content 格式（支持全角/半角破折号）
    //    全角破折号：——（U+2014 U+2014）或 —（U+2014）
    //    半角破折号：-- 或 ---
    //    还有中文连字符：－（U+FF0D）
    const keyContentPattern = /^(.+?)\s*(?:——|---|—|－)\s*(.+)$/;
    const match = working.match(keyContentPattern);

    if (match) {
      const rawKey = match[1].trim();
      const rawContent = match[2].trim();

      if (!rawContent) {
        // 只有 Key 没有 Content，整体当 content
        return this._recordAsTemp(working);
      }

      // 验证 Key 格式
      if (this._isValidKey(rawKey)) {
        const now = new Date().toISOString();
        const saved = {
          name: rawKey.substring(0, 20),
          content: rawContent,
          isTemporary: false,
          skipCount: 0,
          organizeTime: this._defaultOrganizeTime(),
          status: RecordStatus.PENDING,
        };

        // 异步保存（但同步返回结果 — 调用方可以 await record().then 再 save）
        const promise = this.storage.save(saved);
        return {
          type: 'record',
          name: rawKey,
          content: rawContent,
          isTemporary: false,
          _savePromise: promise,
        };
      } else {
        // Key 格式无效 → 整体作为临时记录
        return this._recordAsTemp(working);
      }
    }

    // 3. 纯文本，无 Key → 临时记录
    return this._recordAsTemp(working);
  }

  /**
   * 为指定碎片添加附件
   *
   * @param {string} id — 碎片 ID
   * @param {{type:string, path:string, size:number, createdAt?:string}} file — 附件信息
   * @returns {Promise<{success:boolean, record?:Object, error?:string}>}
   */
  async addAttachment(id, file) {
    const record = await this.storage.getById(id);
    if (!record) {
      return { success: false, error: '碎片不存在' };
    }

    const attachments = record.attachments || [];

    // 检查数量限制
    if (attachments.length >= this._attachmentLimits.maxCount) {
      return { success: false, error: `附件数量已达上限（${this._attachmentLimits.maxCount}个）` };
    }

    // 检查大小限制
    const category = this._guessFileCategory(file.type);
    const maxSize = this._attachmentLimits.maxSizeByType[category] || this._attachmentLimits.maxSizeByType.default;
    if (file.size > maxSize) {
      const maxMB = (maxSize / 1024 / 1024).toFixed(1);
      return { success: false, error: `附件过大：${category} 类文件上限 ${maxMB}MB` };
    }

    const attachment = {
      type: file.type,
      path: file.path,
      size: file.size,
      createdAt: file.createdAt || new Date().toISOString(),
    };

    const updated = await this.storage.update(id, {
      attachments: [...attachments, attachment],
    });

    return { success: true, record: updated };
  }

  /**
   * 设置碎片的整理提醒时间
   *
   * 支持自然语言时间表达：
   * - "明天晚上" → 明天 20:00
   * - "7月10日" → 今年 7月10日
   * - "7天" / "7天后" → 创建后7天
   * - "永不" / "never" → 永不提醒
   *
   * 默认：创建后 7 天
   *
   * @param {string} id — 碎片 ID
   * @param {string} timeStr — 时间表达式
   * @returns {Promise<{success:boolean, organizeTime?:string, error?:string}>}
   */
  async setOrganizeTime(id, timeStr) {
    const record = await this.storage.getById(id);
    if (!record) {
      return { success: false, error: '碎片不存在' };
    }

    const parsed = this._parseOrganizeTime(timeStr);
    if (!parsed) {
      return { success: false, error: `无法解析时间表达式: "${timeStr}"` };
    }

    await this.storage.update(id, { organizeTime: parsed });
    return { success: true, organizeTime: parsed };
  }

  // ═══════════════════════════════════════════════════════
  // v1.0 检索流程
  // ═══════════════════════════════════════════════════════

  /**
   * 搜索碎片
   *
   * 策略：
   * 1. 优先按 Key（name字段）精确/包含匹配
   * 2. 再按全文拆词匹配（去除常见语气词和标点）
   * 3. 多结果按时间倒序排列
   * 4. 无结果返回空数组
   *
   * @param {string} query — 查询文本
   * @returns {Promise<Object[]>}
   */
  async search(query) {
    if (!query || !query.trim()) return [];

    const all = await this.storage.all();
    const q = query.trim();

    // ── 第一轮：Key 精确/包含匹配 ──
    const keyMatches = all.filter(r => {
      const name = (r.name || '').toLowerCase();
      const qLower = q.toLowerCase();
      return name === qLower || name.includes(qLower);
    });

    if (keyMatches.length > 0) {
      // 精确匹配排最前，其余按时间倒序
      const exact = keyMatches.filter(r => (r.name || '').toLowerCase() === q.toLowerCase());
      exact.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const fuzzy = keyMatches.filter(r => (r.name || '').toLowerCase() !== q.toLowerCase());
      fuzzy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return [...exact, ...fuzzy];
    }

    // ── 第二轮：全文拆词匹配 ──
    const stopWords = new Set([
      '了', '的', '吗', '呢', '啊', '吧', '呀', '哈', '嘛', '哪',
      '在', '是', '有', '我', '你', '他', '她', '它', '这', '那',
      '个', '么', '着', '过', '和', '与', '哦', '嗯', '唉', '啦',
    ]);
    const tokens = [...q].filter(c => /[\u4e00-\u9fa5a-zA-Z0-9]/.test(c) && !stopWords.has(c));
    if (tokens.length === 0) return [];

    const scored = all
      .map(r => {
        const text = (r.content || '') + (r.name || '');
        let score = 0;
        for (const t of tokens) {
          if (text.includes(t)) score++;
        }
        return { ...r, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored;
  }

  // ═══════════════════════════════════════════════════════
  // 保护管理（原有）
  // ═══════════════════════════════════════════════════════

  /**
   * 标记碎片为受保护
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async protectFragment(id) {
    return this._protector.markProtected(id);
  }

  /**
   * 取消碎片保护标记
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async unprotectFragment(id) {
    return this._protector.unmark(id);
  }

  /**
   * 验证是否可以删除
   * @param {string} id
   * @returns {Promise<import('./types.js').DeleteVerification>}
   */
  async verifyDelete(id) {
    return this._protector.verifyDelete(id);
  }

  // ═══════════════════════════════════════════════════════
  // v1.0 整理流程
  // ═══════════════════════════════════════════════════════

  /**
   * 启动清理会话
   *
   * 自动获取所有 pending 状态的碎片，创建新会话并启动。
   * 临时Key碎片（isTemporary=true）优先排在前面，方便用户优先处理。
   * 如果当前已有活跃会话，则抛出错误。
   *
   * @returns {Promise<CleanupSession>}
   */
  async startCleanup() {
    if (this._session && this._session.state === SessionState.ACTIVE) {
      throw new Error('已有正在进行的清理会话');
    }

    const pending = await this.getPendingFragments();

    // v1.0: 临时Key碎片优先排在前面
    const tempKeys = pending.filter(r => r.isTemporary);
    const formalKeys = pending.filter(r => !r.isTemporary);
    const ordered = [...tempKeys, ...formalKeys];

    this._session = new CleanupSession(this.storage, ordered);
    const result = this._session.start();

    if (result === 'empty') {
      return this._session; // 无待清理碎片
    }

    return this._session;
  }

  /**
   * 获取当前清理会话
   * @returns {CleanupSession|null}
   */
  get currentSession() {
    return this._session;
  }

  /**
   * 为碎片命名（仅限临时 Key 碎片）
   *
   * @param {string} id — 碎片 ID
   * @param {string} newKey — 新名称（需通过 Key 格式验证）
   * @returns {Promise<{success:boolean, record?:Object, error?:string}>}
   */
  async nameFragment(id, newKey) {
    const record = await this.storage.getById(id);
    if (!record) {
      return { success: false, error: '碎片不存在' };
    }

    if (!this._isValidKey(newKey)) {
      return { success: false, error: 'Key 格式无效：必须包含名词，仅允许中文名/动/形' };
    }

    const updated = await this.storage.update(id, {
      name: newKey.substring(0, 20),
      isTemporary: false,
      status: RecordStatus.KEPT,
    });

    return { success: true, record: updated };
  }

  /**
   * 跳过碎片整理（skipCount 递增）
   *
   * skipCount ≥ 3 时自动标记为 abandoned
   *
   * @param {string} id — 碎片 ID
   * @returns {Promise<{success:boolean, record?:Object, skipCount?:number, becameAbandoned?:boolean, error?:string}>}
   */
  async skipFragment(id) {
    const record = await this.storage.getById(id);
    if (!record) {
      return { success: false, error: '碎片不存在' };
    }

    const newSkipCount = (record.skipCount || 0) + 1;
    const patch = { skipCount: newSkipCount };

    if (newSkipCount >= 3) {
      patch.status = RecordStatus.ABANDONED;
    }

    const updated = await this.storage.update(id, patch);

    return {
      success: true,
      record: updated,
      skipCount: newSkipCount,
      becameAbandoned: newSkipCount >= 3,
    };
  }

  /**
   * 主动废弃碎片
   *
   * @param {string} id — 碎片 ID
   * @returns {Promise<{success:boolean, record?:Object, error?:string}>}
   */
  async abandonFragment(id) {
    const record = await this.storage.getById(id);
    if (!record) {
      return { success: false, error: '碎片不存在' };
    }

    const updated = await this.storage.update(id, {
      status: RecordStatus.ABANDONED,
    });

    return { success: true, record: updated };
  }

  // ═══════════════════════════════════════════════════════
  // v1.0 清理流程
  // ═══════════════════════════════════════════════════════

  /**
   * 自动清理检查
   *
   * 规则：
   * - 废弃记录(abandoned) → 移入回收区 → 30天后永久删除
   * - 未整理记录(pending) → 创建30天后移入回收区
   * - 已整理记录(kept/archived) → 永久保留
   *
   * 回收区逻辑：只有 MemoryStorage 支持 _recycleBin。
   * LocalStorage 直接永久删除。
   *
   * @returns {Promise<{movedToRecycleBin:number, permanentlyRemoved:number}>}
   */
  async checkAutoCleanup() {
    const all = await this.storage.all();
    const now = new Date();
    let movedToRecycleBin = 0;
    let permanentlyRemoved = 0;

    // 获取回收区（仅 MemoryStorage）
    const recycleBin = this.storage._recycleBin;

    for (const record of all) {
      const createdAt = new Date(record.createdAt);
      const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);

      if (record.status === RecordStatus.ABANDONED) {
        // 废弃记录 → 移入回收区
        if (recycleBin) {
          recycleBin.set(record.id, { record: { ...record }, deletedAt: now.toISOString() });
          await this.storage.remove(record.id);
        } else {
          // 无回收区支持的存储，标记为已处理（不实际删除）
          // 实际永久删除由调用方决定
        }
        movedToRecycleBin++;
      } else if (record.status === RecordStatus.PENDING && daysSinceCreation > 30) {
        // 30天未整理 → 移入回收区
        if (recycleBin) {
          recycleBin.set(record.id, { record: { ...record }, deletedAt: now.toISOString() });
          await this.storage.remove(record.id);
          movedToRecycleBin++;
        }
      }
    }

    // 清理回收区中超过30天的记录
    if (recycleBin) {
      for (const [id, entry] of recycleBin) {
        const deletedAt = new Date(entry.deletedAt);
        const daysInBin = (now - deletedAt) / (1000 * 60 * 60 * 24);
        if (daysInBin > 30) {
          await this.storage.removePermanently(id);
          permanentlyRemoved++;
        }
      }
    }

    return { movedToRecycleBin, permanentlyRemoved };
  }

  /**
   * 从回收区恢复碎片
   *
   * 恢复后状态回退为 pending，可重新参与整理。
   *
   * @param {string} id — 碎片 ID
   * @returns {Promise<{success:boolean, record?:Object, error?:string}>}
   */
  async recoverFromBin(id) {
    const recycleBin = this.storage._recycleBin;
    if (!recycleBin) {
      return { success: false, error: '当前存储后端不支持回收区' };
    }

    const entry = recycleBin.get(id);
    if (!entry) {
      return { success: false, error: '回收区中未找到该碎片' };
    }

    // 恢复：status 回退为 pending
    const restored = {
      ...entry.record,
      status: RecordStatus.PENDING,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.save(restored);
    recycleBin.delete(id);

    return { success: true, record: restored };
  }

  /**
   * 检查整理提醒
   *
   * 遍历所有记录，检查 organizeTime 是否到期。
   * 到期但未整理过的记录 → 触发回调。
   *
   * @param {Function} [cb] — 提醒回调，接收到期记录列表
   * @returns {Promise<Object[]>} 到期的记录列表
   */
  async checkOrganizeReminders(cb) {
    const all = await this.storage.all();
    const now = new Date();
    const due = [];

    for (const record of all) {
      // 跳过已整理和废弃的记录
      if (record.status === RecordStatus.KEPT ||
          record.status === RecordStatus.ARCHIVED ||
          record.status === RecordStatus.DELETED ||
          record.status === RecordStatus.ABANDONED) {
        continue;
      }

      // 检查 organizeTime
      const orgTime = record.organizeTime;
      if (!orgTime || orgTime === 'never') continue;

      try {
        const orgDate = new Date(orgTime);
        if (!isNaN(orgDate.getTime()) && orgDate <= now) {
          due.push(record);
        }
      } catch {
        // 无效时间格式，跳过
      }
    }

    if (cb && typeof cb === 'function' && due.length > 0) {
      cb(due);
    }

    return due;
  }

  // ═══════════════════════════════════════════════════════
  // 调度器（原有）
  // ═══════════════════════════════════════════════════════

  /**
   * 启动清理调度器（定时提醒）
   */
  startScheduler() {
    this._scheduler.start();
  }

  /**
   * 停止清理调度器
   */
  stopScheduler() {
    this._scheduler.stop();
  }

  /**
   * 重置调度器计时
   */
  resetScheduler() {
    this._scheduler.reset();
  }

  // ═══════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════

  /**
   * 获取统计信息
   * @returns {Promise<import('./types.js').ZacuibenStats>}
   */
  async getStats() {
    const all = await this.storage.all();
    const stats = {
      totalFragments: all.length,
      pendingFragments: 0,
      keptFragments: 0,
      deletedFragments: 0,
      archivedFragments: 0,
      protectedFragments: 0,
      abandonedFragments: 0,
    };

    for (const r of all) {
      if (r.isProtected) stats.protectedFragments++;
      switch (r.status) {
        case 'pending': stats.pendingFragments++; break;
        case 'kept': stats.keptFragments++; break;
        case 'deleted': stats.deletedFragments++; break;
        case 'archived': stats.archivedFragments++; break;
        case 'abandoned': stats.abandonedFragments++; break;
      }
    }

    return stats;
  }

  /**
   * 注册定时提醒回调（公开API，替代撬私有_scheduler）
   * @param {Function} cb - 到时触发的回调
   */
  onRemind(cb) {
    this._scheduler._onDue = cb;
  }

  /**
   * 清空所有数据
   */
  async clearAll() {
    await this.storage.clear();
    this._session = null;
    this._scheduler.stop();
    this._tempKeyCounter = 0;
  }

  // ═══════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════

  /**
   * 验证 Key 格式：必须含名词，仅允许名/动/形
   * @param {string} key
   * @returns {boolean}
   * @private
   */
  _isValidKey(key) { return isValidKey(key); }

  /**
   * 将文本保存为临时记录
   * @param {string} text — 内容
   * @returns {{type:'record', name:string, content:string, isTemporary:boolean}}
   * @private
   */
  _recordAsTemp(text) {
    this._tempKeyCounter++;
    const name = `临时-${this._tempKeyCounter}`;
    const now = new Date().toISOString();

    const saved = {
      name,
      content: text,
      isTemporary: true,
      skipCount: 0,
      organizeTime: this._defaultOrganizeTime(),
      status: RecordStatus.PENDING,
    };

    const promise = this.storage.save(saved);

    return {
      type: 'record',
      name,
      content: text,
      isTemporary: true,
      _savePromise: promise,
    };
  }

  /**
   * 计算默认整理时间：创建后 7 天
   * @returns {string} ISO 日期字符串
   * @private
   */
  _defaultOrganizeTime() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }

  /**
   * 解析整理时间表达式
   * @param {string} timeStr — 时间表达式
   * @returns {string|null} ISO 日期字符串、"never"、或 null（无法解析）
   * @private
   */
  _parseOrganizeTime(timeStr) {
    if (!timeStr || !timeStr.trim()) return null;

    const str = timeStr.trim();

    // "永不" / "never"
    if (str === '永不' || str.toLowerCase() === 'never') {
      return 'never';
    }

    // "明天晚上" → 明天 20:00
    const tomorrowNight = /^明[天日]晚[上]?$/.test(str);
    if (tomorrowNight) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(20, 0, 0, 0);
      return d.toISOString();
    }

    // "明天" / "明日"
    if (str === '明天' || str === '明日') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "后天" / "後天"
    if (str === '后天' || str === '後天') {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "今天"
    if (str === '今天') {
      const d = new Date();
      d.setHours(20, 0, 0, 0);
      return d.toISOString();
    }

    // "N天" / "N天后"
    const daysMatch = str.match(/^(\d+)\s*天[后後]?$/);
    if (daysMatch) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(daysMatch[1], 10));
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "N周" / "N星期" / "N周后"
    const weeksMatch = str.match(/^(\d+)\s*(?:周|星期)[后後]?$/);
    if (weeksMatch) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(weeksMatch[1], 10) * 7);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "N月" / "N月后"
    const monthsMatch = str.match(/^(\d+)\s*个?月[后後]?$/);
    if (monthsMatch) {
      const d = new Date();
      d.setMonth(d.getMonth() + parseInt(monthsMatch[1], 10));
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "M月D日" / "M月D号"
    const dateMatch = str.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?$/);
    if (dateMatch) {
      const m = parseInt(dateMatch[1], 10);
      const day = parseInt(dateMatch[2], 10);
      if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
        const d = new Date();
        d.setMonth(m - 1, day);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      }
    }

    // "下周一"/"下周二"... 
    const weekdayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    const nextWeekdayMatch = str.match(/^下周([一二三四五六日天])$/);
    if (nextWeekdayMatch) {
      const targetDay = weekdayMap[nextWeekdayMatch[1]];
      const d = new Date();
      const today = d.getDay();
      const daysUntil = (targetDay - today + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    // "周N" / "星期N"
    const thisWeekdayMatch = str.match(/^(?:周|星期)([一二三四五六日天])$/);
    if (thisWeekdayMatch) {
      const targetDay = weekdayMap[thisWeekdayMatch[1]];
      const d = new Date();
      const today = d.getDay();
      const daysUntil = (targetDay - today + 7) % 7;
      d.setDate(d.getDate() + daysUntil);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }

    return null;
  }

  /**
   * 根据 MIME 类型猜测文件类别
   * @param {string} mimeType
   * @returns {'image'|'video'|'audio'|'default'}
   * @private
   */
  _guessFileCategory(mimeType) {
    if (!mimeType) return 'default';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'default';
  }
}

// ═══════════════════════════════════════════════════════════
// 具名导出
// ═══════════════════════════════════════════════════════════

export { SessionState, RecordStatus } from './types.js';
export {
  StorageBackend,
  MemoryStorage,
  LocalStorageStorage,
  createMemoryStorage,
  createLocalStorage,
} from './storage.js';
export { CleanupScheduler } from './scheduler.js';
export { CleanupSession } from './session.js';
export { ProtectionManager } from './protector.js';
export { DialogueEngine, State as DialogueState } from './dialogue-engine.js';
export { identifyIntent, generateReply, hasApiKey } from './state-llm.js';

export default Zacuiben;
