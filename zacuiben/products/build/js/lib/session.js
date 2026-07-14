// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 清理会话 — IDLE → ACTIVE → COMPLETED 状态机
 *
 * 设计意图：
 * - 每次清理是一个"会话"，有明确的生命周期
 * - 逐条处理碎片，用户对每条碎片做出 keep/delete/archive 决策
 * - 支持 skipAll 批量跳过剩余碎片
 * - 进度可随时查询
 *
 * @module zacuiben/session
 */

import { SessionState, RecordStatus } from './types.js';

/**
 * 清理会话
 *
 * @example
 * const session = new CleanupSession(storage, pendingRecords);
 * session.start(); // IDLE → ACTIVE
 * const current = session.current(); // 当前待处理的碎片
 * session.decide('keep');
 * session.decide('archive');
 * // ... 直到所有碎片处理完毕 → COMPLETED
 * const progress = session.getProgress();
 */
export class CleanupSession {
  /**
   * @param {import('./storage.js').StorageBackend} storage — 存储后端
   * @param {Object[]} records — 待清理的碎片列表
   */
  constructor(storage, records = []) {
    /** @type {import('./storage.js').StorageBackend} */
    this._storage = storage;
    /** @type {SessionState} */
    this._state = SessionState.IDLE;
    /** @type {Object[]} */
    this._queue = records.slice();
    /** @type {number} */
    this._index = 0;

    // 计数器
    this._kept = 0;
    this._deleted = 0;
    this._archived = 0;
    this._skipped = 0;
  }

  /**
   * 启动清理会话
   * @returns {'started'|'empty'}
   */
  start() {
    if (this._state !== SessionState.IDLE) {
      return this._state === SessionState.ACTIVE ? 'started' : 'empty';
    }

    if (this._queue.length === 0) {
      this._state = SessionState.COMPLETED;
      return 'empty';
    }

    this._state = SessionState.ACTIVE;
    this._index = 0;
    return 'started';
  }

  /**
   * 获取当前待处理的碎片，返回格式化展示文本
   *
   * 临时Key格式: "未整理（k/N）。临时-3——Content。附件：X张图。这条还没有正式名字，要起一个吗？"
   * 正式Key格式: "未整理（k/N）。Key——Content。好了？"
   *
   * @returns {Object|null} { record, displayText } 或 null
   */
  current() {
    if (this._state !== SessionState.ACTIVE) return null;
    if (this._index >= this._queue.length) return null;
    const record = this._queue[this._index];
    const k = this._index + 1;
    const N = this._queue.length;
    const prefix = `未整理（${k}/${N}）。`;

    let displayText;
    if (record.isTemporary) {
      const attachInfo = (record.attachments && record.attachments.length > 0)
        ? `附件：${this._countImageAttachments(record.attachments)}张图。`
        : '';
      displayText = `${prefix}${record.name}——${record.content}。${attachInfo}这条还没有正式名字，要起一个吗？`;
    } else {
      displayText = `${prefix}${record.name}——${record.content}。好了？`;
    }

    return { record, displayText };
  }

  /**
   * 对当前碎片做出决策，并前进到下一项
   * @param {'keep'|'delete'|'archive'|'skip'} action — 决策动作
   * @returns {Object} { record, action, hasMore }
   */
  async decide(action) {
    if (this._state !== SessionState.ACTIVE) {
      return { record: null, action, hasMore: false, error: '会话未激活' };
    }

    const record = this.current();
    if (!record) {
      this._state = SessionState.COMPLETED;
      return { record: null, action, hasMore: false };
    }

    const frag = record.record;

    // 处理 skip 动作：仅递增 skipCount，不改变 status
    if (action === 'skip') {
      this._skipped++;
      const newSkipCount = (frag.skipCount || 0) + 1;
      const patch = { skipCount: newSkipCount };
      // skipCount ≥ 3 → 自动标记为 abandoned
      if (newSkipCount >= 3) {
        patch.status = RecordStatus.ABANDONED;
      }
      await this._storage.update(frag.id, patch);
      this._index++;
      const hasMore = this._index < this._queue.length;
      if (!hasMore) {
        this._state = SessionState.COMPLETED;
      }
      return {
        record: { ...frag, ...patch },
        action,
        hasMore,
      };
    }

    // 映射动作到状态
    const statusMap = {
      keep: RecordStatus.KEPT,
      delete: RecordStatus.DELETED,
      archive: RecordStatus.ARCHIVED,
    };

    const newStatus = statusMap[action];

    // 更新计数器
    if (action === 'keep') this._kept++;
    else if (action === 'delete') this._deleted++;
    else if (action === 'archive') this._archived++;

    // 持久化状态
    await this._storage.update(frag.id, { status: newStatus });

    // 前进
    this._index++;

    const hasMore = this._index < this._queue.length;
    if (!hasMore) {
      this._state = SessionState.COMPLETED;
    }

    return {
      record: { ...frag, status: newStatus },
      action,
      hasMore,
    };
  }

  /**
   * 为临时 Key 碎片命名
   * @param {string} id — 碎片 ID
   * @param {string} newKey — 新名称（需通过 Key 格式验证）
   * @returns {Promise<Object>} { success, record, error }
   */
  async nameTemp(id, newKey) {
    const record = this._queue.find(r => r.id === id);
    if (!record) {
      return { success: false, record: null, error: '碎片不在当前会话中' };
    }

    // Key 格式验证
    if (!this._isValidKey(newKey)) {
      return { success: false, record: null, error: 'Key 格式无效：必须包含名词，仅允许中文名/动/形' };
    }

    try {
      const updated = await this._storage.update(id, {
        name: newKey,
        isTemporary: false,
        status: RecordStatus.KEPT,
      });
      return { success: true, record: updated };
    } catch (e) {
      return { success: false, record: null, error: e.message };
    }
  }

  /**
   * 跳过当前碎片（不改变状态），前进到下一项
   * @returns {Object} { record, hasMore }
   */
  skip() {
    if (this._state !== SessionState.ACTIVE) {
      return { record: null, hasMore: false };
    }

    const current = this.current();
    if (!current) {
      this._state = SessionState.COMPLETED;
      return { record: null, hasMore: false };
    }

    this._index++;
    const hasMore = this._index < this._queue.length;
    if (!hasMore) {
      this._state = SessionState.COMPLETED;
    }

    return { record: current.record, hasMore };
  }

  /**
   * 批量跳过所有剩余碎片
   * @returns {number} 跳过的碎片数量
   */
  skipAll() {
    if (this._state !== SessionState.ACTIVE) return 0;
    const skipped = this._queue.length - this._index;
    this._index = this._queue.length;
    this._state = SessionState.COMPLETED;
    return skipped;
  }

  /**
   * 获取当前清理进度
   * @returns {import('./types.js').CleanupProgress}
   */
  getProgress() {
    const total = this._queue.length;
    const current = Math.min(this._index, total);
    return {
      total,
      current,
      kept: this._kept,
      deleted: this._deleted,
      archived: this._archived,
      remaining: total - current,
    };
  }

  /**
   * 当前会话状态
   * @returns {SessionState}
   */
  get state() {
    return this._state;
  }

  // ── 内部方法 ──

  /**
   * 验证 Key 格式：必须含名词，仅允许名/动/形
   * @param {string} key
   * @returns {boolean}
   * @private
   */
  _isValidKey(key) {
    if (!key || !key.trim()) return false;

    // 基础词性词典（常用名词、动词、形容词）
    const nounSet = new Set([
      '书', '笔', '纸', '灯', '门', '窗', '房', '家', '人', '手', '脚', '头', '眼', '耳', '口', '鼻',
      '天', '地', '山', '水', '火', '风', '雨', '雪', '云', '雷', '海', '河', '湖', '路', '桥', '车',
      '花', '草', '树', '木', '叶', '果', '鸡', '牛', '猪', '鱼', '猫', '狗', '鸟', '虫', '马',
      '心', '情', '感', '爱', '恨', '思', '想', '梦', '意', '念', '事', '物', '时', '日', '月', '年',
      '话', '语', '字', '文', '章', '书', '信', '诗', '歌', '画', '曲', '音', '乐',
      '饭', '菜', '茶', '酒', '餐', '米', '面', '汤', '糖', '盐', '醋', '油',
      '工作', '学习', '项目', '计划', '任务', '笔记', '记录', '想法', '灵感', '问题', '方案',
      '代码', '文档', '设计', '会议', '报告', '分析', '数据', '信息', '知识', '技能', '经验',
      '朋友', '家庭', '生活', '健康', '运动', '旅行', '美食', '电影', '音乐', '照片', '视频',
      '电脑', '手机', '键盘', '屏幕', '程序', '应用', '网站', '链接', '账号', '密码',
      '名字', '地址', '电话', '邮箱', '日期', '时间', '地点', '事情', '东西',
    ]);

    // 抽取 Key 中的中文字符序列作为词元
    const segments = key.match(/[\u4e00-\u9fa5]+/g) || [];

    // 检查是否包含至少一个名词
    for (const seg of segments) {
      // 先尝试匹配双字词
      for (let i = 0; i < seg.length - 1; i++) {
        const bigram = seg.substring(i, i + 2);
        if (nounSet.has(bigram)) return true;
      }
      // 再尝试单字匹配
      for (const ch of seg) {
        if (nounSet.has(ch)) return true;
      }
    }

    // 如果没有任何中文字符，至少检查是否有英文名词（简化处理）
    if (segments.length === 0 && /[a-zA-Z]{2,}/.test(key)) {
      return true;
    }

    return false;
  }

  /**
   * 统计附件中的图片数量
   * @param {Array<Object>} attachments
   * @returns {number}
   * @private
   */
  _countImageAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments)) return 0;
    const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);
    return attachments.filter(
      a => imageTypes.has(a.type) || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(a.path || '')
    ).length;
  }
}

export default CleanupSession;
