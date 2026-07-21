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
    this._verifyAllTables();
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
      -- ═══ P0: ANALYZING 契约副本（意图级纠错逃生舱） ═══
      CREATE TABLE IF NOT EXISTS analyzing_contract_in (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL DEFAULT 'default',
        rawInput TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS analyzing_contract_out (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL DEFAULT 'default',
        choice TEXT,
        logprobs TEXT,
        intent TEXT,
        inputNature TEXT,
        inputNatureLogprobs TEXT,
        extracted TEXT,
        topicId TEXT,
        createdAt TEXT NOT NULL
      );

      -- ═══ P1: 会话主表 ═══
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'IDLE',
        current_intent TEXT,
        task_type TEXT,
        room_id TEXT,
        project_id TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        tunable_snapshot TEXT
      );

      -- ═══ P2: topic_based 主题演化 ═══
      CREATE TABLE IF NOT EXISTS topicEvolution (
        topicId TEXT PRIMARY KEY,
        userId TEXT NOT NULL DEFAULT 'default',
        projectId TEXT NOT NULL DEFAULT 'default',
        topicName TEXT NOT NULL,
        stateSnapshot TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topicEvolutionEvent (
        eventId TEXT PRIMARY KEY,
        topicId TEXT NOT NULL,
        nodeId TEXT NOT NULL,
        turnType TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        stateChange TEXT,
        askingField TEXT,
        modelOutputSummary TEXT,
        FOREIGN KEY (topicId) REFERENCES topicEvolution(topicId)
      );

      CREATE TABLE IF NOT EXISTS topicEvolutionArchive (
        archiveId TEXT PRIMARY KEY,
        topicId TEXT NOT NULL,
        eventId TEXT NOT NULL,
        archiveType TEXT NOT NULL,
        archivedAt TEXT NOT NULL
      );

      -- ═══ P3: 领域规则网络图 ═══
      CREATE TABLE IF NOT EXISTS domainRules (
        ruleId TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        topicPath TEXT NOT NULL,
        stepName TEXT,
        source TEXT NOT NULL,
        immutableLevel TEXT NOT NULL,
        importance TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'active',
        conditions TEXT,
        edges TEXT,
        version INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ruleCandidates (
        candidateId TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        topicPath TEXT,
        stepName TEXT,
        evidenceCount INTEGER DEFAULT 0,
        passCount INTEGER DEFAULT 0,
        validationRate REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ruleMiningQueue (
        queueId TEXT PRIMARY KEY,
        topicId TEXT,
        stepName TEXT,
        intent TEXT,
        checkpointAt TEXT NOT NULL,
        status TEXT DEFAULT 'pending'
      );

      -- ═══ P4: field_based 进度检查点 ═══
      CREATE TABLE IF NOT EXISTS sessionCheckpoints (
        userId TEXT NOT NULL DEFAULT 'default',
        projectId TEXT NOT NULL DEFAULT 'default',
        lastCompletedStep TEXT NOT NULL,
        completedSteps TEXT NOT NULL,
        stepSnapshots TEXT NOT NULL,
        resumedAt TEXT,
        expiredAt TEXT,
        ttl INTEGER DEFAULT 604800,
        PRIMARY KEY (userId, projectId)
      );

      -- ═══ P5: 房间对话日志（每房间独立，物理隔离） ═══
      CREATE TABLE IF NOT EXISTS roomConversationLog (
        logId TEXT PRIMARY KEY,
        userId TEXT NOT NULL DEFAULT 'default',
        projectId TEXT NOT NULL DEFAULT 'default',
        roomId TEXT NOT NULL,
        roomName TEXT,
        importance TEXT DEFAULT 'normal',
        turnNumber INTEGER NOT NULL,
        userMessage TEXT,
        modelOutput TEXT,
        turnType TEXT,
        askingField TEXT,
        createdAt TEXT NOT NULL,
        segmentType TEXT DEFAULT 'full',
        relatedOutputId TEXT,
        summaryImportance TEXT,
        originalTurnRange TEXT
      );

      -- ═══ P6: 对话全量备份（v5.8 分段保留） ═══
      CREATE TABLE IF NOT EXISTS conversationArchive (
        archiveId TEXT PRIMARY KEY,
        userId TEXT NOT NULL DEFAULT 'default',
        projectId TEXT NOT NULL DEFAULT 'default',
        roomId TEXT NOT NULL,
        turnNumber INTEGER NOT NULL,
        userMessage TEXT,
        modelOutput TEXT,
        turnType TEXT,
        askingField TEXT,
        createdAt TEXT NOT NULL,
        archivedAt TEXT NOT NULL,
        relatedOutputId TEXT
      );

      -- ═══ P7: 全窗口房间状态索引（物化视图） ═══
      CREATE TABLE IF NOT EXISTS roomStateIndex (
        userId TEXT NOT NULL DEFAULT 'default',
        roomId TEXT NOT NULL,
        projectId TEXT NOT NULL DEFAULT 'default',
        roomName TEXT NOT NULL,
        intent TEXT,
        taskType TEXT,
        lastActiveAt TEXT NOT NULL,
        pendingCount INTEGER DEFAULT 0,
        completedCount INTEGER DEFAULT 0,
        lastSummary TEXT,
        PRIMARY KEY (userId, roomId, projectId)
      );

      -- ═══ P8: 产出物总索引 ═══
      CREATE TABLE IF NOT EXISTS outputRegistry (
        outputId TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        projectId TEXT NOT NULL DEFAULT 'default',
        roomName TEXT NOT NULL,
        intent TEXT NOT NULL,
        taskType TEXT NOT NULL,
        outputType TEXT NOT NULL,
        outputPath TEXT NOT NULL,
        outputName TEXT NOT NULL,
        outputSummary TEXT,
        keywords TEXT,
        fileSize INTEGER,
        createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        metadata TEXT
      );

      -- ═══ P9: 产出物（轻量版，进度追踪用） ═══
      CREATE TABLE IF NOT EXISTS outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        room_id TEXT,
        intent TEXT NOT NULL,
        output_name TEXT,
        importance TEXT NOT NULL,
        content TEXT,
        written_at INTEGER
      );

      -- ═══ P10: 项目隔离 ═══
      CREATE TABLE IF NOT EXISTS projectRegistry (
        projectId TEXT PRIMARY KEY,
        projectName TEXT NOT NULL,
        userId TEXT NOT NULL DEFAULT 'default',
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS userLastProject (
        userId TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
        projectId TEXT NOT NULL
      );

      -- ═══ P11: 全局对话审计（保留兼容） ═══
      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        turn_index INTEGER,
        role TEXT,
        content TEXT,
        turn_type TEXT,
        created_at INTEGER
      );

      -- ═══ P12: 全文搜索 ═══
      CREATE VIRTUAL TABLE IF NOT EXISTS conversationArchive_fts USING fts5(
        userMessage, modelOutput, content='conversationArchive', content_rowid='archiveId'
      );
    `);
  }

  /** 验证全部 21 张表是否存在 */
  _verifyAllTables() {
    const required = [
      'analyzing_contract_in', 'analyzing_contract_out',
      'sessions',
      'topicEvolution', 'topicEvolutionEvent', 'topicEvolutionArchive',
      'domainRules', 'ruleCandidates', 'ruleMiningQueue',
      'sessionCheckpoints',
      'roomConversationLog', 'conversationArchive',
      'roomStateIndex',
      'outputRegistry', 'outputs',
      'projectRegistry', 'userLastProject',
      'conversation_log',
    ];
    const missing = [];
    for (const table of required) {
      try {
        this._db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      } catch {
        missing.push(table);
      }
    }
    if (missing.length > 0) {
      console.error(`[contractStore] ❌ 缺少 ${missing.length} 张表: ${missing.join(', ')}`);
    } else {
      console.log(`[contractStore] ✅ ${required.length} 张表全部就绪`);
    }
  }

  // === Session ===

  createSession(sessionId, tunableSnapshot) {
    const now = Date.now();
    this._db.prepare(`INSERT OR REPLACE INTO sessions (session_id, state, room_id, created_at, updated_at, tunable_snapshot) VALUES (?, 'IDLE', ?, ?, ?, ?)`).run(sessionId, 'room_P0', now, now, JSON.stringify(tunableSnapshot));
  }

  updateSessionState(sessionId, state, intent = null, taskType = null, roomId = null) {
    this._db.prepare(`UPDATE sessions SET state=?, current_intent=?, task_type=?, room_id=COALESCE(?, room_id), updated_at=? WHERE session_id=?`).run(state, intent, taskType, roomId, Date.now(), sessionId);
  }

  getSession(sessionId) {
    return this._db.prepare(`SELECT * FROM sessions WHERE session_id=?`).get(sessionId);
  }

  /** 获取最近一次非 IDLE 的会话（用于断点续接） */
  getLastActiveSession() {
    return this._db.prepare(`SELECT * FROM sessions WHERE state != 'IDLE' AND state != 'CLOSING' ORDER BY updated_at DESC LIMIT 1`).get() || null;
  }

  // === Room State Index（全窗口房间状态） ===

  upsertRoomState(roomId, roomName, intent, taskType, userId = 'default') {
    const now = Date.now();
    this._db.prepare(`INSERT OR REPLACE INTO room_state_index (room_id, room_name, intent, task_type, last_active_at, pending_count, completed_count, user_id) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT pending_count FROM room_state_index WHERE room_id=? AND user_id=?), 0), COALESCE((SELECT completed_count FROM room_state_index WHERE room_id=? AND user_id=?), 0), ?)`).run(roomId, roomName, intent, taskType, now, roomId, userId, roomId, userId, userId);
  }

  updateRoomPending(roomId, delta, userId = 'default') {
    this._db.prepare(`UPDATE room_state_index SET pending_count = MAX(0, pending_count + ?), last_active_at = ? WHERE room_id=? AND user_id=?`).run(delta, Date.now(), roomId, userId);
  }

  markRoomComplete(roomId, userId = 'default') {
    this._db.prepare(`UPDATE room_state_index SET pending_count=0, completed_count=completed_count+1, last_active_at=? WHERE room_id=? AND user_id=?`).run(Date.now(), roomId, userId);
  }

  getRoomIndex(userId = 'default') {
    return this._db.prepare(`SELECT * FROM room_state_index WHERE user_id=? ORDER BY last_active_at DESC`).all(userId);
  }

  // === Room Conversation Log（每房间独立对话） ===

  appendRoomLog(roomId, sessionId, turnIndex, role, content, turnType) {
    this._db.prepare(`INSERT INTO room_conversation_log (room_id, session_id, turn_index, role, content, turn_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(roomId, sessionId, turnIndex, role, content, turnType, Date.now());
  }

  getRoomLog(roomId, limit = 20) {
    return this._db.prepare(`SELECT * FROM room_conversation_log WHERE room_id=? ORDER BY id DESC LIMIT ?`).all(roomId, limit);
  }

  // === Session Checkpoint（每房快照） ===

  saveCheckpoint(roomId, sessionId, state, intent, taskType, contractIn, contractOut) {
    this._db.prepare(`INSERT INTO session_checkpoint (room_id, session_id, state, intent, task_type, contract_in, contract_out, snapshot_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(roomId, sessionId, state, intent, taskType, JSON.stringify(contractIn), JSON.stringify(contractOut), Date.now());
  }

  getLatestCheckpoint(roomId) {
    return this._db.prepare(`SELECT * FROM session_checkpoint WHERE room_id=? ORDER BY snapshot_at DESC LIMIT 1`).get(roomId);
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
