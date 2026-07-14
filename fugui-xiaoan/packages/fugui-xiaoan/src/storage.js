// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 存储抽象接口 + 内存实现
 * 
 * 设计意图：核心库不绑定任何具体存储后端。
 * 使用方可以选择内存存储（测试/Demo）、IndexedDB（PWA）、
 * 或实现自己的适配器（如 LocalStorage、远程 API）。
 * 
 * @module fugui-xiaoan/storage
 */

/**
 * 存储接口 — 所有后端必须实现的方法
 * @interface StorageBackend
 */
export class StorageBackend {
  /** @param {Object} record — 保存一条消费记录，返回含 id 的完整记录 */
  async save(record) { throw new Error('Not implemented'); }
  
  /** @param {Object} query — 查询消费记录 */
  async query(query) { throw new Error('Not implemented'); }
  
  /** @returns {Promise<Object[]>} — 获取所有记录 */
  async all() { throw new Error('Not implemented'); }
  
  /** @param {string} id — 删除一条记录 */
  async remove(id) { throw new Error('Not implemented'); }
  
  /** 清空所有记录 */
  async clear() { throw new Error('Not implemented'); }
}

// ─── 内存存储实现 ────────────────────────────────────

/**
 * 内存存储 — 适合 Demo、测试、单个会话使用
 * @implements {StorageBackend}
 */
export class MemoryStorage extends StorageBackend {
  constructor() {
    super();
    /** @type {Map<string, Object>} */
    this._records = new Map();
    this._idCounter = 0;
  }

  async save(record) {
    const id = record.id || `exp_${++this._idCounter}_${Date.now()}`;
    const saved = {
      id,
      text: record.text || '',
      item: record.item || '消费',
      amount: record.amount || 0,
      quantity: record.quantity || null,
      unit: record.unit || null,
      unitPrice: record.unitPrice || null,
      clarifyState: 'NORMAL',
      createdAt: record.createdAt || new Date().toISOString(),
    };
    this._records.set(id, saved);
    return { ...saved };
  }

  async query({ startDate, endDate, keyword, limit = 100 }) {
    let results = [...this._records.values()];
    
    if (startDate) {
      results = results.filter(r => r.createdAt >= startDate);
    }
    if (endDate) {
      results = results.filter(r => r.createdAt <= endDate);
    }
    if (keyword) {
      const kw = keyword.toLowerCase();
      results = results.filter(r => 
        r.item.includes(keyword) || r.text.includes(keyword) ||
        r.item.toLowerCase().includes(kw) || r.text.toLowerCase().includes(kw)
      );
    }
    
    // 按时间倒序
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    
    return results.slice(0, limit);
  }

  async all() {
    const results = [...this._records.values()];
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  async remove(id) {
    return this._records.delete(id);
  }

  async clear() {
    this._records.clear();
    this._idCounter = 0;
  }
}

/**
 * LocalStorage 持久化存储
 * 数据存活于浏览器 localStorage，刷新不丢。
 * @implements {StorageBackend}
 */
export class LocalStorageStorage extends StorageBackend {
  constructor(key = 'fugui_xiaoan_records') {
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
    const id = record.id || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const saved = {
      id,
      text: record.text || '',
      item: record.item || '消费',
      amount: record.amount || 0,
      quantity: record.quantity || null,
      unit: record.unit || null,
      unitPrice: record.unitPrice || null,
      clarifyState: 'NORMAL',
      createdAt: record.createdAt || new Date().toISOString(),
    };
    this._records.push(saved);
    this._save();
    return { ...saved };
  }

  async query({ startDate, endDate, keyword, limit = 100 }) {
    let results = [...this._records];
    if (startDate) results = results.filter(r => r.createdAt >= startDate);
    if (endDate) results = results.filter(r => r.createdAt <= endDate);
    if (keyword) {
      const kw = keyword.toLowerCase();
      results = results.filter(r =>
        r.item.includes(keyword) || r.text.includes(keyword) ||
        r.item.toLowerCase().includes(kw) || r.text.toLowerCase().includes(kw)
      );
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results.slice(0, limit);
  }

  async all() {
    return [...this._records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

  async clear() {
    this._records = [];
    this._save();
  }
}

/**
 * 创建默认内存存储实例
 * @returns {MemoryStorage}
 */
export function createMemoryStorage() {
  return new MemoryStorage();
}

/**
 * 创建 LocalStorage 持久化存储实例（刷新不丢）
 * @param {string} [key] - localStorage 键名
 * @returns {LocalStorageStorage}
 */
export function createLocalStorage(key) {
  return new LocalStorageStorage(key);
}

// ─── 编码工具函数 ──────────────────────────────────

/**
 * Uint8Array → Base64 字符串
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binString);
}

/**
 * Base64 字符串 → Uint8Array
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  const binString = atob(b64);
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
}

// ─── 加密 LocalStorage 实现 ──────────────────────────

/**
 * 加密 LocalStorage 持久化存储
 * 
 * 使用 AES-256-GCM 加密 localStorage 数据，密钥通过 PBKDF2 派生。
 * 零外部依赖，纯 Web Crypto API。
 * 
 * @implements {StorageBackend}
 */
export class EncryptedLocalStorage extends StorageBackend {
  /**
   * @param {string} [key='fugui_encrypted'] - localStorage 键名
   * @param {string} encryptKey - 加密密钥（必填，用于 PBKDF2 派生）
   */
  constructor(key = 'fugui_encrypted', encryptKey) {
    super();
    if (!encryptKey) {
      throw new Error('encryptKey is required for EncryptedLocalStorage');
    }
    this._key = key;
    this._encryptKey = encryptKey;
    /** @type {CryptoKey|null} */
    this._cryptoKey = null;
    /** @type {Object[]} */
    this._records = [];
  }

  /**
   * 初始化：派生密钥 + 加载已有数据
   * 必须在构造后调用
   * @returns {Promise<void>}
   */
  async _init() {
    await this._deriveKey();
    await this._load();
  }

  /**
   * PBKDF2 派生 AES-256-GCM 密钥
   * salt 持久化到 localStorage，同一 encryptKey 可复现
   * @returns {Promise<void>}
   */
  async _deriveKey() {
    const saltKey = this._key + '_salt';

    // 获取或生成 salt
    let salt;
    const storedSalt = localStorage.getItem(saltKey);
    if (storedSalt) {
      salt = base64ToBytes(storedSalt);
    } else {
      salt = crypto.getRandomValues(new Uint8Array(16));
      localStorage.setItem(saltKey, bytesToBase64(salt));
    }

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(this._encryptKey),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this._cryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * AES-GCM 加密
   * @param {string} plaintext - 明文字符串
   * @returns {Promise<string>} Base64 编码的 IV+密文
   */
  async _encrypt(plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this._cryptoKey,
      enc.encode(plaintext)
    );

    // IV 前置拼接密文
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  }

  /**
   * AES-GCM 解密
   * @param {string} b64 - Base64 编码的 IV+密文
   * @returns {Promise<string>} 解密后的 JSON 字符串
   */
  async _decrypt(b64) {
    const combined = base64ToBytes(b64);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this._cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 从 localStorage 加载并解密数据
   * 解密失败静默降级为空数组
   * @returns {Promise<void>}
   */
  async _load() {
    try {
      const raw = localStorage.getItem(this._key);
      if (!raw) {
        this._records = [];
        return;
      }
      const json = await this._decrypt(raw);
      this._records = JSON.parse(json);
    } catch (e) {
      // 解密失败（损坏/密钥变更）→ 静默降级
      console.warn('EncryptedLocalStorage 解密失败，使用空数据集:', e.message);
      this._records = [];
    }
  }

  /**
   * 加密并写入 localStorage
   * @returns {Promise<void>}
   */
  async _save() {
    try {
      const json = JSON.stringify(this._records);
      const encrypted = await this._encrypt(json);
      localStorage.setItem(this._key, encrypted);
    } catch (e) {
      console.warn('EncryptedLocalStorage 写入失败:', e.message);
    }
  }

  /**
   * 保存一条消费记录
   * @param {Object} record
   * @returns {Promise<Object>} 含 id 的完整记录
   */
  async save(record) {
    const id = record.id || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const saved = {
      id,
      text: record.text || '',
      item: record.item || '消费',
      amount: record.amount || 0,
      quantity: record.quantity || null,
      unit: record.unit || null,
      unitPrice: record.unitPrice || null,
      clarifyState: 'NORMAL',
      createdAt: record.createdAt || new Date().toISOString(),
    };
    this._records.push(saved);
    await this._save();
    return { ...saved };
  }

  /**
   * 查询消费记录
   * @param {Object} options
   * @param {string} [options.startDate]
   * @param {string} [options.endDate]
   * @param {string} [options.keyword]
   * @param {number} [options.limit=100]
   * @returns {Promise<Object[]>}
   */
  async query({ startDate, endDate, keyword, limit = 100 }) {
    let results = [...this._records];
    if (startDate) results = results.filter(r => r.createdAt >= startDate);
    if (endDate) results = results.filter(r => r.createdAt <= endDate);
    if (keyword) {
      const kw = keyword.toLowerCase();
      results = results.filter(r =>
        r.item.includes(keyword) || r.text.includes(keyword) ||
        r.item.toLowerCase().includes(kw) || r.text.toLowerCase().includes(kw)
      );
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results.slice(0, limit);
  }

  /**
   * 获取所有记录
   * @returns {Promise<Object[]>}
   */
  async all() {
    return [...this._records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 删除一条记录
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    const idx = this._records.findIndex(r => r.id === id);
    if (idx >= 0) {
      this._records.splice(idx, 1);
      await this._save();
      return true;
    }
    return false;
  }

  /**
   * 清空所有记录
   * @returns {Promise<void>}
   */
  async clear() {
    this._records = [];
    await this._save();
  }
}

/**
 * 创建加密 LocalStorage 存储实例
 * @param {string} [key='fugui_encrypted'] - localStorage 键名
 * @param {string} encryptKey - 加密密钥（必填）
 * @returns {Promise<EncryptedLocalStorage>}
 */
export async function createEncryptedLocalStorage(key = 'fugui_encrypted', encryptKey) {
  const storage = new EncryptedLocalStorage(key, encryptKey);
  await storage._init();
  return storage;
}

export default { StorageBackend, MemoryStorage, LocalStorageStorage, EncryptedLocalStorage, createMemoryStorage, createLocalStorage, createEncryptedLocalStorage };
