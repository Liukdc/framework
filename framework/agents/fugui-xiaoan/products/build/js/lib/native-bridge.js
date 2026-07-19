// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 — 原生能力桥接层（P0 就绪版）
 *
 * Capacitor 全局插件模式，不使用动态 import（WebView 无打包器兼容）。
 *
 * @module fugui-xiaoan-native/bridge
 */

const isNative  = () => { try { return !!(window.Capacitor?.isNativePlatform()); } catch { return false; } };
const isAndroid = () => { try { return window.Capacitor?.getPlatform() === 'android'; } catch { return false; } };
const isIOS     = () => { try { return window.Capacitor?.getPlatform() === 'ios'; } catch { return false; } };

// Capacitor 插件（cap sync 后注入 window.Capacitor.Plugins）
const P = () => window.Capacitor?.Plugins || {};

// ═══ 1. 前台语音识别 ═══════════════════
class NativeVoiceInput {
  constructor() { this._recognition = null; this._onResult = null; this._onEnd = null; }

  async start(onResult, onEnd) {
    this._onResult = onResult; this._onEnd = onEnd;
    return isNative() ? this._startNative() : this._startWeb();
  }

  async _startNative() {
    try {
      const r = await P().SpeechToText.listen({ language: 'zh-CN' });
      this._onResult?.(r?.value || '');
      this._onEnd?.(); return true;
    } catch { return this._startWeb(); }
  }

  async _startWeb() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this._onEnd?.(); return false; }
    this._recognition = new SR();
    this._recognition.lang = 'zh-CN'; this._recognition.interimResults = false;
    this._recognition.onresult = e => { this._onResult?.(e.results[0][0].transcript); };
    this._recognition.onend   = () => this._onEnd?.();
    this._recognition.onerror = () => this._onEnd?.();
    this._recognition.start(); return true;
  }

  stop() { if (this._recognition) { this._recognition.stop(); this._recognition = null; } }
}

// ═══ 2. 快捷入口 ═══════════════════════
class NativeQuickEntry {
  async setup() {
    if (!isNative()) return { android: false, ios: false };
    return { android: isAndroid(), ios: isIOS() };
  }
  onQuickAction(cb) {
    if (!isNative()) return;
    try { P().App?.addListener('appUrlOpen', d => { if ((d.url||'').includes('quick-record')) cb('record'); }); } catch {}
  }
}

// ═══ 3. 通知 ═══════════════════════════
class NativeNotifications {
  constructor() { this._ids = []; }

  async requestPermission() {
    if (!isNative()) return false;
    try { return (await P().LocalNotifications.requestPermissions()).display === 'granted'; } catch { return false; }
  }

  async schedule({ title, body, at, repeat, id }) {
    if (!isNative()) {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
      return false;
    }
    try {
      const n = { id: id || Date.now(), title, body, sound: 'default', smallIcon: 'ic_stat_notification', iconColor: '#E8A840' };
      if (at) n.schedule = { at: new Date(at) };
      if (repeat && isIOS())     n.schedule = { ...n.schedule, repeats: true, every: repeat };
      if (repeat && isAndroid()) n.extra = { repeat };
      await P().LocalNotifications.schedule({ notifications: [n] });
      this._ids.push(n.id); return true;
    } catch { return false; }
  }

  async scheduleDailyReminder(h = 20, m = 0) {
    if (!isNative()) return false;
    const t = new Date(); t.setHours(h, m, 0, 0);
    if (t <= Date.now()) t.setDate(t.getDate() + 1);
    return this.schedule({ id: 1001, title: '📝 富贵小安', body: '今天有什么开销？点这里快速记账', at: t.getTime(), repeat: 'daily' });
  }

  async cancelAll() {
    if (!isNative()) return;
    try {
      const ids = this._ids; this._ids = [];
      if (ids.length) await P().LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
    } catch {}
  }
}

// ═══ 4. 文件导出 ═══════════════════════
class NativeExport {
  async saveFile(content, filename, mime = 'text/csv') {
    if (!isNative()) {
      const b = new Blob([content], { type: mime }), u = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); URL.revokeObjectURL(u);
      return true;
    }
    try { await P().Filesystem.writeFile({ path: filename, data: content, directory: 'DOCUMENTS' }); return true; } catch { return false; }
  }
  async shareFile(content, filename, mime = 'text/csv') {
    if (!isNative()) return this.saveFile(content, filename, mime);
    try {
      await P().Filesystem.writeFile({ path: filename, data: content, directory: 'CACHE' });
      await P().Share.share({ title: '富贵小安 记账数据', text: content.slice(0, 200), dialogTitle: '分享记账数据' });
      return true;
    } catch { return false; }
  }
}

// ═══ 5. SQLite 存储 ═══════════════════
class NativeStorage {
  constructor() { this._db = null; }

  async init() {
    if (!isNative()) return false;
    try {
      const sqlite = P().CapacitorSQLite;
      if (!sqlite) return false;
      this._db = sqlite;
      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL, item TEXT NOT NULL,
          amount REAL NOT NULL, date TEXT NOT NULL,
          content TEXT, created_at TEXT NOT NULL
        )
      `);
      return true;
    } catch { return false; }
  }

  async save(r) {
    if (!this._db) return null;
    const res = await this._db.run(`INSERT INTO records (category,item,amount,date,content,created_at) VALUES (?,?,?,?,?,?)`,
      [r.category, r.item, r.amount, r.date, r.content||'', new Date().toISOString()]);
    return { ...r, id: res.changes?.lastId };
  }

  async getAll() {
    if (!this._db) return [];
    return (await this._db.query(`SELECT * FROM records ORDER BY date DESC LIMIT 5000`)).values || [];
  }

  async query(f) {
    if (!this._db) return [];
    let s = `SELECT * FROM records WHERE 1=1`; const p = [];
    if (f.category) { s += ` AND category=?`; p.push(f.category); }
    if (f.keyword)  { s += ` AND (item LIKE ? OR content LIKE ?)`; p.push(`%${f.keyword}%`, `%${f.keyword}%`); }
    s += ` ORDER BY date DESC LIMIT 1000`;
    return (await this._db.query(s, p)).values || [];
  }

  async delete(id) { if (this._db) await this._db.run(`DELETE FROM records WHERE id=?`, [id]); }

  async getStats() {
    if (!this._db) return { total: 0, sum: 0 };
    const r = await this._db.query(`SELECT COUNT(*) as c, SUM(amount) as s FROM records`);
    return { total: r.values?.[0]?.c || 0, sum: r.values?.[0]?.s || 0 };
  }

  close() {} // noop for Capacitor
}

// ═══ 6. Foreground Service（P1）════════
class NativeForegroundService {
  async start() { return false; }
  async stop() {}
}

// ═══ 导出 ═══════════════════════════════
export const NativeBridge = {
  voice: new NativeVoiceInput(), quickEntry: new NativeQuickEntry(),
  notifications: new NativeNotifications(), export: new NativeExport(),
  storage: new NativeStorage(), foreground: new NativeForegroundService(),
  isNative, isAndroid, isIOS,
};

export async function initNativeBridge() {
  if (!isNative()) { console.log('[富贵小安] Web 模式'); return { native: false }; }
  console.log(`[富贵小安] 原生模式 — ${isAndroid() ? 'Android' : 'iOS'}`);
  const caps = { native: true, platform: isAndroid() ? 'Android' : 'iOS' };
  const [notif, storage] = await Promise.all([
    NativeBridge.notifications.requestPermission(),
    NativeBridge.storage.init(),
  ]);
  caps.notifications = notif; caps.storage = storage; caps.foreground = false;
  console.log('[富贵小安] 能力:', caps);
  return caps;
}
