// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 半成品记录暂存 — 态控 v3.4
 *
 * 用户偏离时模型返回 collectedFields，调度器暂存。
 * 默认保留 24 小时（可通过系统设置调整）。
 *
 * @module fugui-xiaoan/session-store
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STORAGE_KEY = 'fugui_pending_fields';

/** @typedef {{ fields: object, intent: string, savedAt: number, expiresAt: number }} PendingRecord */

export class SessionStore {
  constructor(opts = {}) {
    this._ttl = opts.ttlMs || DEFAULT_TTL_MS;
    this._storage = opts.storage || null; // 可选: 注入 localStorage 或 SQLite
  }

  /**
   * 暂存半成品记录。
   * @param {object} fields - collectedFields
   * @param {string} intent - 当时的 intent
   */
  save(fields, intent) {
    const record = {
      fields,
      intent,
      savedAt: Date.now(),
      expiresAt: Date.now() + this._ttl,
    };
    this._set(record);
    return record;
  }

  /**
   * 获取未过期的半成品记录。
   * @returns {PendingRecord|null}
   */
  get() {
    try {
      const raw = this._get();
      if (!raw) return null;
      if (Date.now() > raw.expiresAt) {
        this.clear();
        return null;
      }
      return raw;
    } catch (e) {
      return null;
    }
  }

  /** 是否有未过期的半成品 */
  has() { return this.get() !== null; }

  /** 清除半成品 */
  clear() {
    try {
      if (this._storage) {
        this._storage.removeItem(STORAGE_KEY);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
  }

  /** 检查并清理过期的 */
  cleanup() {
    const record = this.get();
    if (!record) this.clear();
  }

  // ── 内部 ──

  _get() {
    try {
      const raw = this._storage
        ? this._storage.getItem(STORAGE_KEY)
        : localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  _set(record) {
    try {
      const json = JSON.stringify(record);
      if (this._storage) {
        this._storage.setItem(STORAGE_KEY, json);
      } else {
        localStorage.setItem(STORAGE_KEY, json);
      }
    } catch (e) {}
  }
}

export default SessionStore;
