// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 清理调度器 — 定时触发清理提醒
 *
 * 设计意图：
 * - 使用 setTimeout 链而非 setInterval，避免堆积
 * - 监听 visibilitychange 事件，在用户切回标签页时检查时间差
 * - 默认 30 分钟间隔，可在构造时自定义
 *
 * @module zacuiben/scheduler
 */

/**
 * 清理调度器
 *
 * @example
 * const scheduler = new CleanupScheduler({
 *   intervalMs: 30 * 60 * 1000,  // 30分钟
 *   onDue: () => console.log('该清理碎片了！'),
 * });
 * scheduler.start();
 */
export class CleanupScheduler {
  /**
   * @param {Object} options
   * @param {number} [options.intervalMs=1800000] — 清理间隔（毫秒），默认 30 分钟
   * @param {Function} options.onDue — 到期回调
   * @param {boolean} [options.autoStart=false] — 是否自动开始
   */
  constructor(options = {}) {
    this._intervalMs = options.intervalMs || 30 * 60 * 1000;
    this._onDue = options.onDue || (() => {});
    this._timerId = null;
    this._lastCleanupTime = Date.now();
    this._running = false;

    // 绑定 visibilitychange 处理器
    this._handleVisibility = this._handleVisibility.bind(this);

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * 启动调度器
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastCleanupTime = Date.now();
    this._scheduleNext();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleVisibility);
    }
  }

  /**
   * 停止调度器
   */
  stop() {
    this._running = false;
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibility);
    }
  }

  /**
   * 手动重置计时器（比如刚完成一次清理后）
   */
  reset() {
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    this._lastCleanupTime = Date.now();
    if (this._running) {
      this._scheduleNext();
    }
  }

  /**
   * 获取距上次清理经过的时间（毫秒）
   * @returns {number}
   */
  elapsed() {
    return Date.now() - this._lastCleanupTime;
  }

  /**
   * 是否正在运行
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  // ── 内部方法 ──

  _scheduleNext() {
    if (!this._running) return;
    this._timerId = setTimeout(() => {
      this._lastCleanupTime = Date.now();
      this._onDue();
      this._scheduleNext();
    }, this._intervalMs);
  }

  _handleVisibility() {
    if (document.hidden) return;

    // 用户切回标签页 — 检查是否超时
    const elapsed = Date.now() - this._lastCleanupTime;
    if (elapsed >= this._intervalMs) {
      this._lastCleanupTime = Date.now();
      if (this._timerId) {
        clearTimeout(this._timerId);
        this._timerId = null;
      }
      this._onDue();
      this._scheduleNext();
    }
  }
}

export default CleanupScheduler;
