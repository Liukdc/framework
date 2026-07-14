// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 对话引擎 v5.0 — extends @exomind/dialogue-core
 */

import { State, matchWord, BaseDialogueEngine } from '../../dialogue-core/src/index.js';
import { identifyIntent, generateReply, hasApiKey } from './state-llm.js';
import { clarifyQuestion, tryParseField, validateFieldValue } from './clarify-templates.js';
import { parse } from './parser.js';

export { State };

const CANCEL_WORDS = ['算了', '不记了', '不要了'];

// ═══ 对话引擎 ═══════════════════════
export class DialogueEngine extends BaseDialogueEngine {
  constructor(opts = {}) {
    super(opts);

    this._xiaoan   = opts.xiaoan;
    this._mode     = opts.mode || 'simple';
    this._apiKey   = opts.apiKey || null;

    this._fields           = {};
    this._requiredFields   = [];
    this._clarifyQueue     = [];
    this._lastRecord       = null;
    this._confirmDelete    = null;
    this._confirmDeleteQueue = null;
    this._confirmDeleteIdx   = null;
    this._intentContext    = null;
    this._pendingOffTaskInput = null;
    this._autoDroppedRecord = null;

    this._wakeKeywords  = ['小安出来记一下', '小安出来', '小安记一下', '记一下', '记账'];

    this._resetRequiredFields();
  }

  _getExitMessage() { return '小安都记好了，拜拜。'; }
  _getNoKeyWarning() { return '⚠️ 请设置 API Key'; }
  _getNoKeyReply() { return '请设置API Key'; }

  _resetRequiredFields() {
    this._requiredFields = ['category', 'amount', 'time'];
  }

  get mode()   { return this._mode; }

  setMode(m) {
    this._mode = m;
    this._requiredFields = ['category', 'amount', 'time'];
    if (m === 'detailed') this._requiredFields.push('quantity');
  }

  _hasApiKey() { return hasApiKey(this._apiKey); }

  // ── 入口（覆盖基类，增加 CANCEL_WORDS 检查）──

  async handleInput(text) {
    const t = text.trim();
    if (!t) return { reply: '', state: this._state };

    // CANCEL_WORDS: CLARIFYING 态或 WAITING_CONFIRM 态下拦截
    if ((this._state === State.CLARIFYING || this._state === State.WAITING_CONFIRM) && matchWord(t, this._cancelWords)) {
      this._fields = {};
      this._clarifyQueue = [];
      this._pendingOffTaskInput = null;
      this._output('好的，不记了。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    return super.handleInput(text);
  }

  // ── 唤醒（硬编码）─────────────────

  _handleWake(t) {
    if (!this._wakeKeywords.some(k => t.includes(k))) {
      this._output('说『小安出来记一下』叫醒我。', 'system');
      return { reply: '', state: this._state };
    }
    this._setState(State.LISTENING);
    this._fields = {};
    this._pendingOffTaskInput = null;
    this._intentContext = null;
    const modeLabel = this._mode === 'simple' ? '简单' : '细致';
    this._output(`小安在呢。（${modeLabel}模式）想记什么？`, 'system');
    return { reply: '', state: this._state };
  }

  // ── LISTENING：意图识别 → 按意图分发 ──

  async _handleListening(text) {
    if (this._confirmDelete) return this._handleDeleteConfirm(text);

    this._setState(State.ANALYZING);
    this._output('…', 'thinking');

    // ═══ 第 1 次 LLM：意图识别 ═══
    let result;
    try {
      result = await identifyIntent(text, this._apiKey);
    } catch (e) {
      this._output('脑子有点晕，再说一次？', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    const { intent, subType, confidence, extracted } = result;

    // ── 意图防抖检查（v1.5.1）──
    const flap = this._checkFlap(intent);
    if (flap.locked) {
      this._antiFlapLocked = true;
      this._output(`确定是要${this._intentLabel(flap.anchorIntent)}对吗？确认一下～`, 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
    this._antiFlapLocked = false;

    if (confidence < 80) {
      const guide = confidence >= 60
        ? `您是想要${this._intentLabel(intent)}吗？`
        : '没太明白，您是想要记账、查询还是删除呢？';
      this._output(guide, 'system');
      this._setState(State.LISTENING);
      return { reply: guide, state: this._state };
    }

    this._intentContext = { intent, subType, extracted };

    // modifyTarget 优先
    if (extracted?.modifyTarget === 'last') {
      if (confidence < 80) {
        this._output('您是要修改刚才那条吗？', 'system');
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
      }
      return this._handleModify();
    }

    // ═══ 第 2 次 LLM：按意图生成 ═══
    try {
      if (intent === 'record') {
        this._fillFields(text, extracted);
        const gen = await super._generateWithL1Retry(() => generateReply('record', { mode: this._mode, fields: this._fields }, this._apiKey));
        const reply = this._applyL2Scan(gen.reply);
        this._output(reply || clarifyQuestion(
          (gen.missingFields && gen.missingFields[0]) || 'category', this._mode, this._fields.category
        ), 'system');
        return this._applyMissingFields(gen);
      }

      const gen = await super._generateWithL1Retry(() => generateReply(intent, { mode: this._mode, fields: this._fields, subType }, this._apiKey));
      const reply = this._applyL2Scan(gen.reply);
      if (reply) this._output(reply, 'system');

      switch (intent) {
        case 'query':   return this._handleQuery(text, subType);
        case 'delete':  return this._handleDelete(text);
        case 'exit':    return this._doClose();
        case 'compare': return this._handleCompare(text);
        default:
          this._setState(State.LISTENING);
          return { reply: gen.reply || '', state: this._state };
      }
    } catch (e) {
      this._output('小安愣了一下。再说一次？', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
  }

  // ── 记账 ──────────────────────────

  _fillFields(text, llmExt) {
    const results = parse(text);
    const parsed = (results && results.length > 0) ? results[0] : {};
    this._fields = {
      category: llmExt.category || parsed.item || '',
      amount:   llmExt.amount   || parsed.amount || null,
      time:     llmExt.time     || null,
    };
    if (this._mode === 'simple') { this._fields.quantity = 1; this._fields.unit = ''; }
  }

  _applyMissingFields(gen) {
    if (gen.missingFields && gen.missingFields.length > 0) {
      this._clarifyQueue = [...gen.missingFields];
      this._setState(State.CLARIFYING);
      return { reply: '', state: this._state, clarify: this._clarifyQueue[0] };
    }
    return this._doRecord();
  }

  _hasPendingFields() {
    return Object.values(this._fields).some(v => v !== null && v !== undefined && v !== '');
  }

  async _doRecord() {
    this._setState(State.EXECUTING);
    const cat = this._fields.category || '其他';
    const amt = this._fields.amount;
    const time = this._fields.time || '今天';
    // 将时间字段拼入文本，让 parser 正确解析日期
    const result = await this._xiaoan.record(`${time} ${cat} ${amt}`);
    this._lastRecord = { category: cat, amount: amt, time, result };
    this._output(`已记录：${cat} ${amt}元。`, 'done');
    this._fields = {};
    this._intentContext = null;
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  // ── CLARIFYING：硬解析 ────────────

  async _handleClarifying(text) {
    const t = text.trim();
    const tl = t.toLowerCase();

    // 全局硬匹配：退出词
    if (matchWord(t, this._getExitWords())) {
      this._fields = {};
      this._clarifyQueue = [];
      this._output('小安都记好了，拜拜。', 'system');
      return this._doClose();
    }

    // 取消词
    if (matchWord(t, this._cancelWords)) {
      this._fields = {};
      this._clarifyQueue = [];
      this._output('好的，不记了。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    const f = this._clarifyQueue[0];
    const val = tryParseField(text, f);

    if (val === null) {
      // ── 硬解析失败：按模式路由 ──
      if (this._mode === 'detailed') {
        // 细致模式 → WAITING_CONFIRM
        this._pendingOffTaskInput = text;
        this._setState(State.WAITING_CONFIRM);
        this._startWaitingTimer();
        const cat = this._fields.category || '未知';
        const amt = this._fields.amount ?? '?';
        const fieldLabel = { category: '种类', amount: '金额', time: '时间', quantity: '数量' }[f] || f;
        this._output(
          `您问的问题跟现在记账无关。还缺${fieldLabel}没记呢（已采集：${cat} ${amt}元），这条还继续吗？`,
          'system'
        );
        return { reply: '', state: this._state };
      }

      // 简单模式 → 引导语 + 清空 + 重定向
      if (this._hasPendingFields()) {
        this._output('好的。之前那条还没记完，先放一边。', 'system');
      }
      this._fields = {};
      this._clarifyQueue = [];
      this._pendingOffTaskInput = null;
      return this._handleListening(text);
    }

    // ── 值域守卫（v1.5.1 新增）──
    const vResult = validateFieldValue(f, val);
    if (vResult.ok === false) {
      this._output(vResult.reason, 'system');
      return { reply: '', state: this._state, clarify: f };
    }
    if (vResult.ok === 'confirm') {
      this._output(vResult.reason, 'system');
      // 仍填入，但标记待确认（后续可扩展 _fields._confirmed）
    }

    // 填入字段
    if (f === 'time') {
      if (!val || val === '') {
        this._fields.time = '今天';
        this._output('好的，默认今天。', 'system');
      } else {
        this._fields.time = val;
        // 用户明确说了"今天"不输出多余的话
      }
    } else {
      this._fields[f] = val;
    }

    this._clarifyQueue.shift();
    if (this._clarifyQueue.length === 0) {
      return this._doRecord();
    }

    const next = this._clarifyQueue[0];
    this._output(clarifyQuestion(next, this._mode, this._fields.category), 'clarify');
    return { reply: '', state: this._state, clarify: next };
  }

  // ── WAITING_CONFIRM ───────────────

  _startWaitingTimer() {
    this._clearTimer();
    this._waitingTimer = setTimeout(() => {
      if (this._state === State.WAITING_CONFIRM) {
        this._fields = {};
        this._clarifyQueue = [];
        this._pendingOffTaskInput = null;
        this._setState(State.LISTENING);
        // 静默回收，不输出
      }
    }, 10000);
  }

  async _handleWaitingConfirm(text) {
    this._clearTimer();
    const t = text.trim().toLowerCase();

    // 继续记
    if (t === '继续记' || t === '好' || t === '记' || t === '继续') {
      this._pendingOffTaskInput = null;
      this._setState(State.CLARIFYING);
      const f = this._clarifyQueue[0];
      this._output(clarifyQuestion(f, this._mode, this._fields.category), 'clarify');
      return { reply: '', state: this._state, clarify: f };
    }

    // 放弃 + 重定向
    if (t === '不记了' || t === '算了' || t === '放弃' || t === '取消') {
      const offTask = this._pendingOffTaskInput || '';
      this._fields = {};
      this._clarifyQueue = [];
      this._pendingOffTaskInput = null;
      this._intentContext = null;
      this._setState(State.LISTENING);
      if (offTask) return this._handleListening(offTask);
      return { reply: '', state: this._state };
    }

    // 拜拜
    if (matchWord(text, this._getExitWords())) {
      this._fields = {};
      this._clarifyQueue = [];
      this._pendingOffTaskInput = null;
      this._intentContext = null;
      this._output('小安都记好了，拜拜。', 'system');
      return this._doClose();
    }

    // ── 自动路由判定（v1.5.1 新增）──
    if (this._pendingOffTaskInput && !this._antiFlapLocked) {
      try {
        const result = await identifyIntent(text, this._apiKey);
        const nConf = result.confidence || 0;
        const nIntent = result.intent;
        const fieldCount = Object.values(this._fields).filter(
          v => v !== null && v !== undefined && v !== ''
        ).length;

        // 四条件判定
        if (nConf >= 90 && nIntent !== 'delete' && nIntent !== 'exit' && fieldCount <= 1) {
          // 自动路由
          this._autoDroppedRecord = {
            fields: { ...this._fields },
            droppedAt: Date.now(),
            status: 'suspended',
          };
          this._fields = {};
          this._clarifyQueue = [];
          this._pendingOffTaskInput = null;
          this._intentContext = null;
          this._setState(State.LISTENING);
          return this._handleListening(text);
        }

        // 字段 ≥ 2 → 硬编码确认模板
        if (fieldCount >= 2 && nConf >= 90 && nIntent !== 'delete' && nIntent !== 'exit') {
          const summary = Object.entries(this._fields)
            .filter(([, v]) => v)
            .map(([k, v]) => ({ category: '种类', amount: '金额', time: '时间', quantity: '数量' }[k] + v))
            .join('、');
          this._output(`你是要${this._intentLabel(nIntent)}，不记刚才的${summary}了？`, 'system');
          this._startWaitingTimer();
          return { reply: '', state: this._state };
        }
      } catch (e) { /* 自动路由失败 → 走默认引导 */ }
    }

    // 其他输入 → 重新引导
    this._output('可以说"继续记"恢复记账，或"不记了"放弃。', 'system');
    this._startWaitingTimer();
    return { reply: '', state: this._state };
  }

  // ── 查询 ──────────────────────────

  async _handleQuery(text, subType) {
    try {
      const all = await this._xiaoan.getAllRecords();
      if (!all?.length) {
        this._output('还没记过账呢。', 'system');
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
      }

      const kw = (this._intentContext?.extracted?.category || text)
        .replace(/花了多少|查一下|查|多少|花了|帮我|这个月|昨天|今天/g, '').trim();

      // ── 多类查询(union)：categories 数组 ──
      if (subType === 'union') {
        const cats = this._intentContext?.extracted?.categories;
        if (!cats || !cats.length) {
          this._output('想查哪几类呢？', 'system');
          this._setState(State.LISTENING);
          return { reply: '', state: this._state };
        }
        const found = cats.map(c => {
          const subset = all.filter(r => (r.category || '').includes(c));
          const total = subset.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
          return { category: c, count: subset.length, total };
        }).filter(f => f.count > 0);

        if (!found.length) {
          this._output('没找到相关的记录。', 'system');
        } else {
          const parts = found.map(f => `「${f.category}」${f.count}笔${f.total}元`);
          this._output(parts.join('，') + '。', 'done');
        }
        this._intentContext = null;
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
      }

      const matches = all.filter(r => {
        const item = (r.item || r.category || r.name || '').toLowerCase();
        return item.includes(kw.toLowerCase()) || kw.toLowerCase().includes(item.slice(0, 2));
      });

      if (!matches.length) {
        this._output('没找到相关的记录。', 'system');
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
      }

      if (subType === 'sum') {
        const total = matches.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        this._output(`「${kw}」共 ${matches.length} 笔，合计 ${total} 元。`, 'done');
      }

      matches.slice(0, 5).forEach(r => {
        const d = r.date || r.createdAt;
        const ds = d ? new Date(d).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
        this._output(`${ds} ${r.item || r.category || ''} ${r.amount}元`, 'result_item');
      });

    } catch (e) {
      this._output('查询出错了。', 'system');
    }

    this._intentContext = null;
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  _handleCompare(text) {
    this._intentContext = null;
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  // ── 删除 ──────────────────────────

  async _handleDelete(text) {
    this._confirmDelete = null;
    const all = await this._xiaoan.getAllRecords();
    const kw = (this._intentContext?.extracted?.category || text)
      .replace(/删|删除|去掉|不要了/g, '').trim();

    const matches = all.filter(r =>
      (r.item || r.category || '').toLowerCase().includes(kw.toLowerCase())
    );

    if (!matches.length) {
      this._output('没有找到符合条件的记录。', 'system');
      this._intentContext = null;
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    if (matches.length === 1) {
      const r = matches[0];
      const d = r.date || r.createdAt;
      const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
      this._output(`找到：${ds} ${r.item || r.category || ''} ${r.amount}元。确认删除？`, 'system');
      this._confirmDelete = r;
      this._confirmDeleteQueue = [r];
      this._confirmDeleteIdx = 0;
    } else if (matches.length <= 3) {
      this._confirmDelete = matches[0];
      this._confirmDeleteQueue = matches;
      this._confirmDeleteIdx = 0;
      const r = matches[0];
      const d = r.date || r.createdAt;
      const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
      this._output(`找到：${ds} ${r.item || r.category || ''} ${r.amount}元。是这条吗？`, 'system');
    } else if (matches.length <= 10) {
      matches.slice(0, 3).forEach((r, i) => {
        const d = r.date || r.createdAt;
        const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
        this._output(`${i + 1}. ${ds} ${r.item || r.category || ''} ${r.amount}元`, 'result_item');
      });
      this._output(`还有 ${matches.length - 3} 条更早的，需要都列出来吗？`, 'system');
      this._confirmDeleteQueue = matches;
      this._confirmDeleteIdx = -1;
    } else {
      matches.slice(0, 3).forEach((r, i) => {
        const d = r.date || r.createdAt;
        const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
        this._output(`${i + 1}. ${ds} ${r.item || r.category || ''} ${r.amount}元`, 'result_item');
      });
      this._output(`匹配记录较多（共 ${matches.length} 条），请说时间和种类缩小范围，或取消本次删除。`, 'system');
    }

    this._intentContext = null;
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  async _handleDeleteConfirm(text) {
    const t = text.trim();

    if (this._confirmDeleteIdx === -1) {
      if (t === '是' || t === '要') {
        const toShow = this._confirmDeleteQueue.slice(3, 10);
        toShow.forEach((r, i) => {
          const d = r.date || r.createdAt;
          const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
          this._output(`${i + 4}. ${ds} ${r.item || r.category || ''} ${r.amount}元`, 'result_item');
        });
        if (this._confirmDeleteQueue.length > 10) {
          this._output(`匹配记录较多（共 ${this._confirmDeleteQueue.length} 条），请说时间和种类缩小范围。`, 'system');
          this._confirmDeleteQueue = null;
          this._confirmDelete = null;
          this._confirmDeleteIdx = null;
        } else {
          this._output('请说"是"逐条确认，或说时间和种类缩小范围。', 'system');
          this._confirmDelete = this._confirmDeleteQueue[0];
          this._confirmDeleteIdx = 0;
        }
      } else {
        this._output('请说时间和种类缩小范围，或取消本次删除。', 'system');
        this._confirmDeleteQueue = null;
        this._confirmDelete = null;
        this._confirmDeleteIdx = null;
      }
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    if (t === '是' || t === '删掉' || t === '确认') {
      const r = this._confirmDelete;
      await this._xiaoan.delete(r.id || r._id || r.content);
      this._output('已删除。', 'done');
      this._confirmDelete = null;
      this._confirmDeleteQueue = null;
      this._confirmDeleteIdx = null;
    } else if (t === '不是') {
      this._confirmDeleteIdx++;
      if (this._confirmDeleteIdx < this._confirmDeleteQueue.length) {
        this._confirmDelete = this._confirmDeleteQueue[this._confirmDeleteIdx];
        const r = this._confirmDelete;
        const d = r.date || r.createdAt;
        const ds = d ? new Date(d).toLocaleDateString('zh-CN') : '';
        this._output(`这条呢：${ds} ${r.item || r.category || ''} ${r.amount}元。是这条吗？`, 'system');
        this._setState(State.LISTENING);
        return { reply: '', state: this._state };
      }
      this._output('已经看完了，没有匹配的吗？请说时间和种类缩小范围。', 'system');
      this._confirmDelete = null;
      this._confirmDeleteQueue = null;
      this._confirmDeleteIdx = null;
    } else if (t === '算了' || t === '都不要' || t === '都不是' || t === '取消') {
      this._output('好的，不删了。', 'system');
      this._confirmDelete = null;
      this._confirmDeleteQueue = null;
      this._confirmDeleteIdx = null;
    } else {
      this._output('可以说"是"确认删除，或"不是"看下一条。', 'system');
      return { reply: '', state: this._state };
    }
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  // ── 修改 ──────────────────────────

  async _handleModify() {
    if (!this._lastRecord?.result) {
      this._output('没有可修改的记录。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    // 用 _lastRecord.result.id 删除，失败则明确告知用户而非静默降级
    const rec = this._lastRecord.result;
    try {
      await this._xiaoan.delete(rec.id || rec._id);
    } catch (e) {
      this._output('修改失败，请手动删除后重新记录。', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    this._fields = {};
    this._clarifyQueue = ['category', 'amount', 'time'];
    this._setState(State.CLARIFYING);
    this._output('好的，删掉了。从种类开始重新来。花在什么上面？', 'system');
    return { reply: '', state: this._state, clarify: 'category' };
  }

  // ── 退出 ──────────────────────────

  _doClose() {
    this._clearTimer();
    this._fields = {};
    this._clarifyQueue = [];
    this._pendingOffTaskInput = null;
    this._intentContext = null;
    this._setState(State.CLOSING);
    setTimeout(() => this._setState(State.IDLE), 2000);
    return { reply: '', state: this._state };
  }

  // ── 工具 ──────────────────────────

  _intentLabel(intent) {
    const m = { record: '记账', query: '查询', delete: '删除', exit: '退出', compare: '比对', other: '其他' };
    return m[intent] || intent;
  }

}
