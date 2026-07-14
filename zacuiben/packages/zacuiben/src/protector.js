// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 保护管理器 — 标记/取消保护 + 删除前验证
 *
 * 设计意图：
 * - 用户可以将重要碎片标记为"受保护"
 * - 受保护的碎片在删除时需要二次确认
 * - verifyDelete 返回 {allowed, reason} 供 UI 层使用
 *
 * @module zacuiben/protector
 */

/**
 * 保护管理器
 *
 * @example
 * const protector = new ProtectionManager(storage);
 * await protector.markProtected('frag_001');
 * const result = protector.verifyDelete('frag_001');
 * // → { allowed: false, reason: '该碎片已标记为重要，请先取消保护后再删除' }
 */
export class ProtectionManager {
  /**
   * @param {import('./storage.js').StorageBackend} storage — 存储后端
   */
  constructor(storage) {
    /** @type {import('./storage.js').StorageBackend} */
    this._storage = storage;
  }

  /**
   * 将碎片标记为受保护
   * @param {string} id — 碎片 ID
   * @returns {Promise<Object|null>} 更新后的记录，或 null
   */
  async markProtected(id) {
    return this._storage.update(id, { isProtected: true });
  }

  /**
   * 取消碎片的保护标记
   * @param {string} id — 碎片 ID
   * @returns {Promise<Object|null>} 更新后的记录，或 null
   */
  async unmark(id) {
    return this._storage.update(id, { isProtected: false });
  }

  /**
   * 验证是否可以删除指定碎片
   * 
   * 受保护的碎片不允许直接删除，必须先取消保护。
   * 非受保护的碎片允许删除。
   *
   * @param {string} id — 碎片 ID
   * @returns {Promise<import('./types.js').DeleteVerification>}
   */
  async verifyDelete(id) {
    const records = await this._storage.all();
    const record = records.find(r => r.id === id);

    if (!record) {
      return { allowed: false, reason: '碎片不存在或已被删除' };
    }

    if (record.isProtected) {
      return {
        allowed: false,
        reason: '该碎片已标记为重要，请先取消保护后再删除',
      };
    }

    return { allowed: true, reason: '' };
  }

  /**
   * 检查碎片是否受保护
   * @param {string} id — 碎片 ID
   * @returns {Promise<boolean>}
   */
  async isProtected(id) {
    const records = await this._storage.all();
    const record = records.find(r => r.id === id);
    return !!(record && record.isProtected);
  }
}

export default ProtectionManager;
