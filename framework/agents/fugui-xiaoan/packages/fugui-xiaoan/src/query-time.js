// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 时间范围解析器
 * 
 * 将中文时间修饰词转为具体的日期范围。
 * 
 * @module fugui-xiaoan/query-time
 */

/**
 * 解析时间修饰词
 * @param {string} text - 包含时间词的文本
 * @returns {{start: string, end: string}|null}
 */
export function parseTimeRange(text) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // ── 日级别 ──
  if (/今天|今日/.test(text)) {
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start: today.toISOString(), end: end.toISOString() };
  }
  
  if (/昨天|昨日/.test(text)) {
    const start = new Date(today);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (/前天/.test(text)) {
    const start = new Date(today);
    start.setDate(start.getDate() - 2);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  
  // ── 周级别 ──
  if (/这周|本周|这礼拜/.test(text)) {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const start = new Date(today);
    start.setDate(today.getDate() - diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  
  if (/上周/.test(text)) {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - diff);
    const end = new Date(thisMonday);
    end.setDate(thisMonday.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  
  // ── 月级别 ──
  if (/这个月|这月|本月/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  
  if (/上个月|上月/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  // ── 年级别 ──
  if (/今年|本年/.test(text)) {
    const start = new Date(now.getFullYear(), 0, 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (/去年|上年/.test(text)) {
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  // ── 季度 ──
  const qMatch = text.match(/[Qq]([1-4])|第?([一二三四])季度/);
  if (qMatch) {
    const qNum = qMatch[1] ? parseInt(qMatch[1]) : {一:1,二:2,三:3,四:4}[qMatch[2]];
    if (qNum) {
      const year = now.getFullYear();
      const qStart = new Date(year, (qNum - 1) * 3, 1);
      const qEnd = new Date(year, qNum * 3, 0, 23, 59, 59, 999);
      return { start: qStart.toISOString(), end: qEnd.toISOString() };
    }
  }

  // ── 相对天数 ──
  const dayMatch = text.match(/最近?\s*(\d+)\s*天/);
  if (dayMatch) {
    const n = parseInt(dayMatch[1]);
    const start = new Date(today);
    start.setDate(start.getDate() - n + 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  // ── 相对月数 ──
  const monMatch = text.match(/最近?\s*(\d+)\s*(个)?月/);
  if (monMatch) {
    const n = parseInt(monMatch[1]);
    const start = new Date(now.getFullYear(), now.getMonth() - n + 1, 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  
  return null;
}

export default { parseTimeRange };
