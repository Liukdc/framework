// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * CloudBase 文档型数据库存储适配器
 *
 * 实现 StorageBackend 接口，数据存腾讯云 CloudBase。
 * 使用匿名登录，每人独立 _openid 隔离。
 *
 * @module cloudbase-storage
 */

/**
 * @class CloudBaseStorage
 */
export class CloudBaseStorage {
  /**
   * @param {object} opts
   * @param {object} opts.app — cloudbase.init() 返回的实例
   */
  constructor(opts = {}) {
    this._app = opts.app;
    this._db = null;
    this._openid = null;
    this._ready = false;
    this._collName = 'records';
  }

  /** 是否已登录云 */
  get isCloud() { return true; }

  /** 当前用户 ID */
  get userId() { return this._openid; }

  /** 是否已就绪 */
  get ready() { return this._ready; }

  /**
   * 初始化：匿名登录 + 获取数据库引用
   */
  async init() {
    const auth = this._app.auth({ persistence: 'local' });
    const loginState = await auth.getLoginState();
    if (!loginState) {
      await auth.anonymousAuthProvider().signIn();
    }
    const state = await auth.getLoginState();
    this._openid = state?.user?.uid || 'anon';
    this._db = this._app.database();
    this._ready = true;
    return this._openid;
  }

  /**
   * 获取当前登录态（用于 UI 显示）
   */
  async getLoginState() {
    const auth = this._app.auth({ persistence: 'local' });
    return await auth.getLoginState();
  }

  /**
   * 退出登录（匿名登录无法退出，但可以清理本地缓存）
   */
  async signOut() {
    const auth = this._app.auth({ persistence: 'local' });
    await auth.signOut();
    this._ready = false;
    this._openid = null;
  }

  /** 存一条记录 */
  async addRecord(record) {
    if (!this._ready) await this.init();
    const doc = {
      _openid: this._openid,
      category: record.category || '',
      item: record.item || '',
      amount: record.amount || 0,
      content: record.content || record.name || '',
      date: record.date || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const result = await this._db.collection(this._collName).add(doc);
    return { ...doc, _id: result.id || result._id };
  }

  /** 获取全部记录 */
  async getAllRecords() {
    if (!this._ready) await this.init();
    const res = await this._db.collection(this._collName)
      .where({ _openid: this._openid })
      .orderBy('date', 'desc')
      .limit(1000)
      .get();
    return (res.data || []).map(this._normalize);
  }

  /** 按条件查询 */
  async queryRecords(filter = {}) {
    if (!this._ready) await this.init();
    let query = this._db.collection(this._collName).where({ _openid: this._openid });
    if (filter.category) query = query.where({ category: filter.category });
    const res = await query.orderBy('date', 'desc').limit(500).get();
    let records = (res.data || []).map(this._normalize);
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      records = records.filter(r => (r.item || '').toLowerCase().includes(kw) || (r.content || '').toLowerCase().includes(kw) || (r.category || '').toLowerCase().includes(kw));
    }
    if (filter.startDate) records = records.filter(r => new Date(r.date) >= new Date(filter.startDate));
    if (filter.endDate) records = records.filter(r => new Date(r.date) <= new Date(filter.endDate));
    return records;
  }

  /** 更新一条记录 */
  async updateRecord(id, updates) {
    if (!this._ready) await this.init();
    await this._db.collection(this._collName).doc(id).update(updates);
  }

  /** 删除一条记录 */
  async deleteRecord(id) {
    if (!this._ready) await this.init();
    await this._db.collection(this._collName).doc(id).remove();
  }

  /** 清空当前用户全部 */
  async clearAll() {
    if (!this._ready) await this.init();
    const all = await this.getAllRecords();
    for (const r of all) {
      if (r._id) await this._db.collection(this._collName).doc(r._id).remove();
    }
  }

  /** 获取记录数 */
  async getCount() {
    if (!this._ready) await this.init();
    const res = await this._db.collection(this._collName)
      .where({ _openid: this._openid })
      .count();
    return res.total || 0;
  }

  /**
   * 从所有记录中提取分类列表（本地计算）
   */
  async listCategories() {
    const records = await this.getAllRecords();
    const set = new Set();
    records.forEach(r => { if (r.category) set.add(r.category); });
    return [...set];
  }

  // ── 标准接口别名（与 storage.js / supabase-storage 一致）──

  /** @see addRecord */
  async save(record) { return this.addRecord(record); }

  /** @see queryRecords */
  async query(filter) { return this.queryRecords(filter); }

  /** @see deleteRecord */
  async delete(id) { return this.deleteRecord(id); }

  /** @see updateRecord */
  async update(id, updates) { return this.updateRecord(id, updates); }

  // ── 内部 ──────────────────────────────

  _normalize(doc) {
    return {
      _id: doc._id || doc.id,
      id: doc._id || doc.id,
      category: doc.category || '',
      item: doc.item || '',
      name: doc.category || '',
      amount: doc.amount || 0,
      content: doc.content || doc.item || '',
      date: doc.date,
      createdAt: doc.createdAt || doc.date,
    };
  }
}

/**
 * 便捷工厂：从环境 ID 创建 CloudBase 实例
 * 需要在页面先加载 cloudbase SDK
 *
 * @param {string} envId — CloudBase 环境 ID
 * @returns {Promise<CloudBaseStorage>}
 */
export async function createCloudBaseStorage(envId) {
  if (typeof window === 'undefined' || !window.cloudbase) {
    throw new Error('CloudBase SDK 未加载，请在 HTML 中引入 cloudbase.full.js');
  }
  const app = window.cloudbase.init({ env: envId });
  const storage = new CloudBaseStorage({ app });
  await storage.init();
  return storage;
}
