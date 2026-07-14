// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 数据导出引擎 — CSV / JSON
 * @module fugui-xiaoan/export
 */

const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility

/**
 * @param {Object[]} records
 * @returns {string} UTF-8 CSV string
 */
export function toCSV(records) {
  if (!records || !records.length) return BOM + '日期,分类,项目,金额\n';
  const header = '日期,分类,项目,金额';
  const rows = records.map(r => {
    const date = fmtCSV(r.date || r.createdAt || '');
    const cat  = escCSV(r.category || r.name || '');
    const item = escCSV(r.item || r.content || '');
    const amt  = r.amount != null ? r.amount : '';
    return `${date},${cat},${item},${amt}`;
  });
  return BOM + [header, ...rows].join('\n');
}

/**
 * @param {Object[]} records
 * @param {boolean} [pretty=false]
 * @returns {string} JSON string
 */
export function toJSON(records, pretty = false) {
  const clean = (records || []).map(r => ({
    date:     r.date || r.createdAt || '',
    category: r.category || r.name || '',
    item:     r.item || r.content || '',
    amount:   parseFloat(r.amount) || 0,
    notes:    r.notes || r.note || '',
  }));
  return JSON.stringify(clean, null, pretty ? 2 : 0);
}

/**
 * 触发浏览器下载
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function download(content, filename, mimeType = 'text/csv') {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── helpers ────────────────────

function escCSV(s) {
  s = String(s || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function fmtCSV(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}
