// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 追问状态机 — "只问一次"的工程实现
 * 
 * 核心设计（来自专利交底书）：
 * 1. 信息不完整时发起一次追问
 * 2. 用户回复→补全，不回复→2分钟后自动放弃
 * 3. 放弃后不再追问，以原始文本保存
 * 
 * 状态流转：PENDING → ASKED → NORMAL / ABANDONED
 * 
 * @module fugui-xiaoan/clarify
 */

import { ClarifyState } from './types.js';

/** 追问超时时间（毫秒），生产环境2分钟 */
const TIMEOUT_MS = 2 * 60 * 1000;

/**
 * 创建追问状态机上下文（实例级闭包，避免多实例共享状态）
 * 
 * 每次调用返回独立的追问状态表，确保多个 FuguiXiaoan 实例互不干扰。
 * 专利交底书定义：每条支出记录对应一个独立状态机。
 * 
 * @returns {Object} 追问上下文方法集合
 */
export function createClarifyContext() {
  /** @type {Map<string, {askedAt: number, question: string}>} */
  const pendingClarifications = new Map();

  /**
   * 检查是否需要追问，如果需要则发起
   * @param {string} id - 记录 ID
   * @param {string} itemText - 用户输入的原始文本
   * @returns {{ question: string } | null} 追问内容，或 null 表示不需要追问
   */
  function checkAndAsk(id, itemText) {
    const pending = pendingClarifications.get(id);
    if (pending) return null; // 已在追问中
  
    // 清理超时的旧追问
    cleanTimeouts();
  
    const now = Date.now();
    const question = `好的，「${itemText}」记下了。花了多少钱呢？（只问这一次~）`;
  
    pendingClarifications.set(id, {
      askedAt: now,
      question,
    });
  
    return { question };
  }

  /**
   * 处理用户对追问的回复
   * @param {string} id - 记录 ID
   * @returns {boolean} 是否成功处理
   */
  function handleReply(id) {
    const pending = pendingClarifications.get(id);
    if (!pending) return false;
    pendingClarifications.delete(id);
    return true;
  }

  /**
   * 获取追问状态
   * @param {string} id - 记录 ID
   * @returns {string} 当前状态
   */
  function getState(id) {
    const pending = pendingClarifications.get(id);
    if (!pending) return ClarifyState.NORMAL;
  
    const elapsed = Date.now() - pending.askedAt;
    if (elapsed > TIMEOUT_MS) {
      pendingClarifications.delete(id);
      return ClarifyState.ABANDONED;
    }
  
    return ClarifyState.ASKED;
  }

  /**
   * 获取当前追问内容
   * @param {string} id - 记录 ID
   * @returns {string|null}
   */
  function getQuestion(id) {
    const pending = pendingClarifications.get(id);
    return pending ? pending.question : null;
  }

  /**
   * 清理所有超时的追问
   */
  function cleanTimeouts() {
    const now = Date.now();
    for (const [id, pending] of pendingClarifications) {
      if (now - pending.askedAt > TIMEOUT_MS) {
        pendingClarifications.delete(id);
      }
    }
  }

  /**
   * 清空指定追问（用户主动放弃）
   * @param {string} id - 记录 ID
   */
  function clear(id) {
    pendingClarifications.delete(id);
  }

  return { checkAndAsk, handleReply, getState, getQuestion, cleanTimeouts, clear };
}

export default createClarifyContext;
