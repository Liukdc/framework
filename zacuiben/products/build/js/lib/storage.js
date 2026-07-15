// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 存储抽象接口 + 内存/LocalStorage 实现
 *
 * 设计意图：核心库不绑定任何具体存储后端。
 * 使用方可以选择内存存储（测试/Demo）、LocalStorage（浏览器持久化），
 * 或实现自己的适配器（如 IndexedDB、远程 API）。
 *
 * 复用小安（fugui-xiaoan）的 MemoryStorage / LocalStorageStorage 模式。
 *
 * @module zacuiben/storage
 */

// ═══════════════════════════════════════════════════════════
// 存储接口
// ═══════════════════════════════════════════════════════════

/**
 * 存储后端接口 — 所有后端必须实现的方法
 * @interface StorageBackend
 */
export class StorageBackend {
  /**
   * 保存一条碎片记录
   * @param {Object} record
   * @returns {Promise<Object>} 含 id 的完整记录
   */
  async save(record) { throw new Error('Not implemented'); }

  /**
   * 获取所有记录
   * @returns {Promise<Object[]>}
   */
  async all() { throw new Error('Not implemented'); }

  /**
   * 删除一条记录
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) { throw new Error('Not implemented'); }

  /**
   * 按 ID 获取单条记录
   * @param {string} id
   * @returns {Promise<Object|null>} 完整记录，或 null
   */
  async getById(id) { throw new Error('Not implemented'); }

  /**
   * 更新一条记录的部分字段
   * @param {string} id
   * @param {Object} patch — 要更新的字段
   * @returns {Promise<Object|null>} 更新后的完整记录，或 null
   */
  async update(id, patch) { throw new Error('Not implemented'); }

  /**
   * 永久删除一条记录（不可恢复）
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async removePermanently(id) { throw new Error('Not implemented'); }

  /**
   * 清空所有记录
   */
  async clear() { throw new Error('Not implemented'); }
}

// ═══════════════════════════════════════════════════════════
// 内存存储
// ═══════════════════════════════════════════════════════════

/**
 * 内存存储 — 适合 Demo、测试、单次会话使用
 * @implements {StorageBackend}
 */
export class MemoryStorage extends StorageBackend {
  constructor() {
    super();
    /** @type {Map<string, Object>} */
    this._records = new Map();
    /**
     * 回收区 — 软删除后暂存于此，30天后永久删除
     * @type {Map<string, {record: Object, deletedAt: string}>}
     */
    this._recycleBin = new Map();
    this._idCounter = 0;
  }

  async save(record) {
    const id = record.id || `frag_${++this._idCounter}_${Date.now()}`;
    const now = new Date().toISOString();
    const saved = {
      id,
      name: record.name || (record.content || '').substring(0, 20),
      content: record.content || '',
      isProtected: !!record.isProtected,
      status: record.status || 'pending',
      createdAt: record.createdAt || now,
      updatedAt: now,
      isTemporary: !!record.isTemporary,
      skipCount: record.skipCount || 0,
      organizeTime: record.organizeTime || null,
      attachments: record.attachments || [],
    };
    this._records.set(id, saved);
    return { ...saved };
  }

  async all() {
    const results = [...this._records.values()];
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  async getById(id) {
    const record = this._records.get(id);
    return record ? { ...record } : null;
  }

  async remove(id) {
    return this._records.delete(id);
  }

  async removePermanently(id) {
    // 从主记录和回收区中彻底清除
    this._records.delete(id);
    this._recycleBin.delete(id);
    return true;
  }

  async update(id, patch) {
    const existing = this._records.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    this._records.set(id, updated);
    return { ...updated };
  }

  async clear() {
    this._records.clear();
    this._recycleBin.clear();
    this._idCounter = 0;
  }
}

// ═══════════════════════════════════════════════════════════
// LocalStorage 持久化存储
// ═══════════════════════════════════════════════════════════

/**
 * LocalStorage 持久化存储
 * 数据存活于浏览器 localStorage，刷新不丢。
 * @implements {StorageBackend}
 */
export class LocalStorageStorage extends StorageBackend {
  /**
   * @param {string} [key='zacuiben_records'] — localStorage 键名
   */
  constructor(key = 'zacuiben_records') {
    super();
    this._key = key;
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._key);
      this._records = raw ? JSON.parse(raw) : [];
    } catch {
      this._records = [];
    }
  }

  _save() {
    try {
      localStorage.setItem(this._key, JSON.stringify(this._records));
    } catch (e) {
      console.warn('localStorage 写入失败（可能已满）:', e.message);
    }
  }

  async save(record) {
    const id = record.id || `frag_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();
    const saved = {
      id,
      name: record.name || (record.content || '').substring(0, 20),
      content: record.content || '',
      isProtected: !!record.isProtected,
      status: record.status || 'pending',
      createdAt: record.createdAt || now,
      updatedAt: now,
      isTemporary: !!record.isTemporary,
      skipCount: record.skipCount || 0,
      organizeTime: record.organizeTime || null,
      attachments: record.attachments || [],
    };
    this._records.push(saved);
    this._save();
    return { ...saved };
  }

  async all() {
    return [...this._records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id) {
    const record = this._records.find(r => r.id === id);
    return record ? { ...record } : null;
  }

  async remove(id) {
    const idx = this._records.findIndex(r => r.id === id);
    if (idx >= 0) {
      this._records.splice(idx, 1);
      this._save();
      return true;
    }
    return false;
  }

  async removePermanently(id) {
    // 从主记录中彻底清除
    const idx = this._records.findIndex(r => r.id === id);
    if (idx >= 0) {
      this._records.splice(idx, 1);
      this._save();
      return true;
    }
    return false;
  }

  async update(id, patch) {
    const idx = this._records.findIndex(r => r.id === id);
    if (idx < 0) return null;
    this._records[idx] = {
      ...this._records[idx],
      ...patch,
      id: this._records[idx].id,
      updatedAt: new Date().toISOString(),
    };
    this._save();
    return { ...this._records[idx] };
  }

  async clear() {
    this._records = [];
    this._save();
  }
}

// ═══════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════

/**
 * 创建默认内存存储实例
 * @returns {MemoryStorage}
 */
export function createMemoryStorage() {
  return new MemoryStorage();
}

/**
 * 创建 LocalStorage 持久化存储实例（刷新不丢）
 * @param {string} [key] — localStorage 键名
 * @returns {LocalStorageStorage}
 */
export function createLocalStorage(key) {
  return new LocalStorageStorage(key);
}

export default {
  StorageBackend,
  MemoryStorage,
  LocalStorageStorage,
  createMemoryStorage,
  createLocalStorage,
};
