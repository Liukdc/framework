// @MetaAgent v5.8 — contract-store.js
// SQLite + WAL + conversationArchive FTS5
// 存储：会话状态、topicEvolution、产出物、对话日志

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getTunable } from './tunables.js';

export class ContractStore {
  constructor(dbPath, tunables) {
    this._tunables = tunables;
    this._dbPath = dbPath;
    this._db = null;
    this._initDir();
  }

  _initDir() {
    const dir = join(this._dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  async open() {
    // 使用 better-sqlite3（兼容层：内存模式）
    const Database = await this._loadSQLite();
    this._db = new Database(this._dbPath);

    if (getTunable(this._tunables, 'contractStoreWal')) {
      this._db.pragma('journal_mode = WAL');
    }

    this._createTables();
    return this;
  }

  async _loadSQLite() {
    try {
      const m = await import('better-sqlite3');
      return m.default;
    } catch {
      // fallback: 内存模拟（支持 INSERT/SELECT/UPDATE）
      return class MemoryDB {
        constructor() {
          this._data = new Map();
          this._fts = new Map();
          this._nextId = 1;
          // 初始化表名检测
          this._tables = new Set();
        }
        prepare(sql) {
          return {
            run: (...args) => this._execute(sql, args),
            get: (...args) => this._getOne(sql, args),
            all: (...args) => this._getAll(sql, args),
          };
        }
        exec(sql) {
          // 提取表名用于后续匹配
          const m = sql.match(/CREATE\s+(?:TABLE|VIRTUAL TABLE)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
          if (m) this._tables.add(m[1]);
        }
        pragma() {}

        _execute(sql, args) {
          // 用 SQL+args 作为 key 存储原始参数
          if (sql.includes('INSERT') || sql.includes('REPLACE')) {
            const table = this._extractTable(sql);
            if (!this._data.has(table)) this._data.set(table, []);
            const row = this._bindArgs(sql, args);
            row._id = this._nextId++;
            this._data.get(table).push(row);
          } else if (sql.includes('UPDATE')) {
            const table = this._extractTable(sql);
            const rows = this._data.get(table) || [];
            // 简单匹配 session_id
            const sessionIdIdx = sql.indexOf('session_id=');
            if (sessionIdIdx > -1 && args.length >= 2) {
              const sessionId = args[args.length - 1];
              const state = args[0];
              for (const row of rows) {
                if (row.session_id === sessionId) {
                  row.state = state;
                  row.updated_at = args[2] || Date.now();
                }
              }
            }
          }
          return { changes: 1 };
        }
        _getOne(sql, args) {
          const rows = this._getAll(sql, args);
          return rows[0] || null;
        }
        _getAll(sql, args) {
          const table = this._extractTable(sql);
          const rows = this._data.get(table) || [];
          // 从 WHERE 子句提取过滤字段名
          const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
          if (whereMatch && args.length > 0) {
            const field = whereMatch[1];
            return rows.filter(r => r[field] === args[0]);
          }
          return rows;
        }
        _extractTable(sql) {
          const m = sql.match(/FROM\s+(\w+)/i) || sql.match(/INTO\s+(\w+)/i) || sql.match(/UPDATE\s+(\w+)/i);
          return m ? m[1] : 'unknown';
        }
        _bindArgs(sql, args) {
          // 简单绑定：从左到右匹配列
          const cols = sql.match(/\(([^)]+)\)/)?.[1]?.split(',').map(c => c.trim().split(/\s+/)[0]) || [];
          const row = {};
          args.forEach((val, i) => { if (cols[i]) row[cols[i]] = val; });
          return row;
        }
        close() {}
      };
    }
  }

  _createTables() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'IDLE',
        current_intent TEXT,
        task_type TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        tunable_snapshot TEXT
      );

      CREATE TABLE IF NOT EXISTS topic_evolution (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        topic_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        change_level TEXT NOT NULL,  -- major/minor/patch/active/abandoned/checkpoint
        state_snapshot TEXT,
        created_at INTEGER,
        UNIQUE(session_id, topic_id, change_level)
      );

      CREATE TABLE IF NOT EXISTS outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        intent TEXT NOT NULL,
        output_name TEXT,
        importance TEXT NOT NULL,
        content TEXT,
        written_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        turn_index INTEGER,
        role TEXT,
        content TEXT,
        turn_type TEXT,
        created_at INTEGER
      );
    `);

    // v5.8: FTS5 全文搜索
    if (getTunable(this._tunables, 'fts5Enabled')) {
      try {
        this._db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
            session_id, role, content, tokenize='unicode61'
          );
        `);
      } catch { /* FTS5 不可用时静默跳过 */ }
    }
  }

  // === Session ===

  createSession(sessionId, tunableSnapshot) {
    const now = Date.now();
    this._db.prepare(`INSERT OR REPLACE INTO sessions (session_id, state, created_at, updated_at, tunable_snapshot) VALUES (?, 'IDLE', ?, ?, ?)`).run(sessionId, now, now, JSON.stringify(tunableSnapshot));
  }

  updateSessionState(sessionId, state, intent = null, taskType = null) {
    this._db.prepare(`UPDATE sessions SET state=?, current_intent=?, task_type=?, updated_at=? WHERE session_id=?`).run(state, intent, taskType, Date.now(), sessionId);
  }

  getSession(sessionId) {
    return this._db.prepare(`SELECT * FROM sessions WHERE session_id=?`).get(sessionId);
  }

  /** 获取最近一次非 IDLE 的会话（用于断点续接） */
  getLastActiveSession() {
    return this._db.prepare(`SELECT * FROM sessions WHERE state != 'IDLE' AND state != 'CLOSING' ORDER BY updated_at DESC LIMIT 1`).get() || null;
  }

  // === Topic Evolution ===

  appendTopicEvent(sessionId, topicId, intent, changeLevel, stateSnapshot = null) {
    const now = Date.now();
    this._db.prepare(`INSERT OR REPLACE INTO topic_evolution (session_id, topic_id, intent, change_level, state_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, topicId, intent, changeLevel, JSON.stringify(stateSnapshot), now);
  }

  getTopicEvents(sessionId) {
    return this._db.prepare(`SELECT * FROM topic_evolution WHERE session_id=? ORDER BY created_at DESC`).all(sessionId);
  }

  getTopicHistory(topicId) {
    return this._db.prepare(`SELECT * FROM topic_evolution WHERE topic_id=? ORDER BY created_at DESC`).all(topicId);
  }

  /** 按 session+intent 查最近 topicId（跨会话恢复） */
  getTopicHistoryByIntent(sessionId, intent) {
    return this._db.prepare(`SELECT * FROM topic_evolution WHERE session_id=? AND intent=? ORDER BY created_at DESC LIMIT 1`).get(sessionId, intent);
  }

  // === Outputs ===

  writeOutput(sessionId, intent, outputName, importance, content) {
    this._db.prepare(`INSERT INTO outputs (session_id, intent, output_name, importance, content, written_at) VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, intent, outputName, importance, content, Date.now());
  }

  getOutputs(sessionId) {
    return this._db.prepare(`SELECT * FROM outputs WHERE session_id=? ORDER BY written_at DESC`).all(sessionId);
  }

  // === S3 roomStateIndex ===

  appendSegmentBoundary(sessionId, prevIntent) {
    const now = Date.now();
    this._db.prepare(`INSERT INTO conversation_log (session_id, turn_index, role, content, turn_type, created_at) VALUES (?, -1, 'system', ?, 'segment_cut', ?)`).run(sessionId, `[S3_CUT] prevIntent=${prevIntent}`, now);
  }

  // === Conversation Log ===

  appendConversation(sessionId, turnIndex, role, content, turnType) {
    this._db.prepare(`INSERT INTO conversation_log (session_id, turn_index, role, content, turn_type, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, turnIndex, role, content, turnType, Date.now());

    // v5.7: 产出物确认后分段标记
    if (getTunable(this._tunables, 'segmentationOnConfirm') && turnType === 'complete') {
      this._db.prepare(`INSERT INTO conversation_log (session_id, turn_index, role, content, turn_type, created_at) VALUES (?, ?, 'system', '[SEGMENT_CUT]', 'segment_cut', ?)`).run(sessionId, turnIndex + 1, Date.now());
    }

    // v5.8: FTS5 同步写入
    if (getTunable(this._tunables, 'fts5Enabled')) {
      try {
        this._db.prepare(`INSERT INTO conversation_fts (session_id, role, content) VALUES (?, ?, ?)`).run(sessionId, role, content.slice(0, 4096));
      } catch { /* 静默 */ }
    }
  }

  getConversationHistory(sessionId, limit = 50) {
    return this._db.prepare(`SELECT * FROM conversation_log WHERE session_id=? ORDER BY turn_index ASC LIMIT ?`).all(sessionId, limit);
  }

  // v5.8: 全文搜索
  searchConversations(query, limit = 20) {
    if (!getTunable(this._tunables, 'fts5Enabled')) return [];
    try {
      return this._db.prepare(`SELECT * FROM conversation_fts WHERE content MATCH ? LIMIT ?`).all(query, limit);
    } catch {
      return [];
    }
  }

  close() {
    if (this._db) this._db.close();
  }
}
