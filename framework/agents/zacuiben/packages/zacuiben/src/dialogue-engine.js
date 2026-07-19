// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂碎本 对话引擎 v2.2 — 态控闭环（v1.5.1 对齐）
 *
 * 9状态：IDLE→LISTENING→ANALYZING→RECORDING_CONTENT→RECORDING_WAIT→RECORDING_TIME→SEARCHING→ORGANIZING→CLOSING
 * v2.2新增：L1重试(LLM失败重试1次)、L2扫描(禁用语静默替换)、检索嗅探(找/搜/查→跳过LLM)
 * v2.1新增：RECORDING_WAIT轻量守护态、值域守卫、L1/L2防线、意图防抖、词表优先级修复
 *
 * @module zacuiben/dialogue-engine
 */

import { identifyIntent, generateReply, hasApiKey } from './state-llm.js';
import { isValidKey } from './valid-key.js';
import { matchWord, AntiFlapGuard, scanForbiddenTerms } from '@exomind/dialogue-core';

export const State = {
  IDLE:              'idle',
  LISTENING:         'listening',
  ANALYZING:         'analyzing',
  RECORDING_CONTENT: 'recording_content',
  RECORDING_WAIT:    'recording_wait',
  RECORDING_TIME:    'recording_time',
  SEARCHING:         'searching',
  ORGANIZING:        'organizing',
  CLOSING:           'closing',
};

// ── 杂碎本专属 L2 扩展禁用语（核心词表由 @exomind/dialogue-core 提供）──
const ZACUIBEN_EXTRA_TERMS = ['去备份', '是否同步', '上传到', '去相册'];

const WAKE_WORDS   = ['杂碎本'];
const EXIT_WORDS   = ['拜拜', '退出', '再见'];
const CANCEL_WORDS = ['算了', '不记了', '不要了'];

// ═══ 默认值 ═════════════════════════
const DEFAULT_ORG_DAYS = 7;

export class DialogueEngine {
  constructor(opts = {}) {
    this._zacuiben = opts.zacuiben;
    this._apiKey   = opts.apiKey || null;

    this._state     = State.IDLE;
    this._fields    = {};
    this._warnedNoKey = false;
    this._timeTimer   = null;
    this._orgIndex    = 0;
    this._orgQueue    = [];
    this._searchResults = [];
    this._confirmDelete = null;

    this._onOutput      = opts.onOutput || (() => {});
    this._onStateChange = opts.onStateChange || (() => {});

    // v2.1 新增
    this._antiFlap = new AntiFlapGuard();
    this._antiFlapLocked = false;
    this._timeRetryCount = 0;
  }

  get state() { return this._state; }

  _setState(s) { this._state = s; this._onStateChange(s); }
  _clearTimer() { if (this._timeTimer) { clearTimeout(this._timeTimer); this._timeTimer = null; } }

  // ── L1 重试 + L2 扫描（v2.2 落库）──

  /** LLM 调用包装：失败重试 1 次，两次都失败 → 返回默认兜底 */
  async _generateWithL1Retry(fn) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await fn(); }
      catch (e) { if (attempt === 1) throw e; }
    }
  }

  /** L2 禁用语扫描：命中 → 替换为默认兜底（MVP 静默替换） */
  _applyL2Scan(reply) {
    if (!reply || typeof reply !== 'string') return reply;
    const hits = scanForbiddenTerms(reply, ZACUIBEN_EXTRA_TERMS);
    return hits.length > 0 ? '好的。' : reply;
  }

  // ── 入口 ──────────────────────────

  async handleInput(text) {
    const t = text.trim();
    if (!t) return { reply: '', state: this._state };

    if (!hasApiKey(this._apiKey)) {
      if (!this._warnedNoKey) { this._warnedNoKey = true; this._output('⚠️ 请设置 API Key', 'system'); }
      return { reply: '', state: this._state };
    }

    // ── 第0层优先级（v2.1 修复：放弃词 > 退出词在子流程态）──
    const inSubProcess = [State.RECORDING_CONTENT, State.RECORDING_WAIT,
      State.RECORDING_TIME, State.SEARCHING, State.ORGANIZING].includes(this._state);
    if (inSubProcess && matchWord(t, CANCEL_WORDS)) {
      this._clearTimer();
      this._fields = {};
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    if (matchWord(t, EXIT_WORDS)) {
      this._clearTimer();
      this._output('好的，拜拜。', 'system');
      this._fields = {};
      this._setState(State.CLOSING);
      setTimeout(() => this._setState(State.IDLE), 2000);
      return { reply: '', state: this._state };
    }

    switch (this._state) {
      case State.IDLE:              return this._handleWake(t);
      case State.LISTENING:         return this._handleListening(t);
      case State.RECORDING_CONTENT: return this._handleRecContent(t);
      case State.RECORDING_WAIT:    return this._handleRecWait(t);
      case State.RECORDING_TIME:    return this._handleRecTime(t);
      case State.SEARCHING:         return this._handleSearching(t);
      case State.ORGANIZING:        return this._handleOrganizing(t);
      default: return { reply: '', state: this._state };
    }
  }

  // ── 唤醒 ──────────────────────────

  _handleWake(t) {
    if (!matchWord(t, WAKE_WORDS)) {
      this._output('说"杂碎本"叫醒我。', 'system');
      return { reply: '', state: this._state };
    }
    this._setState(State.LISTENING);
    this._fields = {};
    this._output('杂碎本在呢。想记什么？', 'system');
    return { reply: '', state: this._state };
  }

  // ── LISTENING：意图识别 ───────────

  async _handleListening(text) {
    if (matchWord(text, CANCEL_WORDS)) {
      this._fields = {};
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    // ── 硬嗅探：明显检索/退出 → 跳过 LLM（v2.2 新增，对齐 fugui）──
    if (this._looksLikeSearchOrExit(text)) {
      if (matchWord(text, EXIT_WORDS)) {
        this._clearTimer();
        this._output('好的，拜拜。', 'system');
        this._setState(State.CLOSING);
        setTimeout(() => this._setState(State.IDLE), 2000);
        return { reply: '', state: this._state };
      }
      // 检索 → 硬提取 key，跳过 LLM
      const searchKey = text.replace(/找一下|找|搜一下|搜|查一下|查了|查/g, '').trim();
      if (searchKey) return this._doSearch(searchKey);
    }

    this._setState(State.ANALYZING);
    this._output('…', 'thinking');

    let result;
    try {
      result = await identifyIntent(text, this._apiKey);
    } catch (e) {
      this._output('脑子有点晕，再说一次？', 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }

    const { intent, confidence, extracted } = result;

    // ── 意图防抖（v2.1 新增）──
    const flap = this._antiFlap.record(intent);
    if (flap.locked) {
      this._antiFlapLocked = true;
      this._output(`确定是要${this._label(flap.anchorIntent)}对吗？`, 'system');
      this._setState(State.LISTENING);
      return { reply: '', state: this._state };
    }
    this._antiFlapLocked = false;

    if (confidence < 80) {
      const guide = confidence >= 60
        ? `您是想要${this._label(intent)}吗？`
        : '没听明白，请说"记一下"来记录，或"找XXX"来检索。';
      this._output(guide, 'system');
      this._setState(State.LISTENING);
      return { reply: guide, state: this._state };
    }

    switch (intent) {
      case 'record':
        return this._routeRecord(text, extracted);
      case 'search':
        return this._routeSearch(extracted);
      case 'organize':
        return this._routeOrganize();
      case 'setting':
        this._output('请到设置页面修改提醒周期。', 'system');
        this._setState(State.IDLE);
        return { reply: '', state: this._state };
      default:
        try {
          const gen = await this._generateWithL1Retry(() => generateReply('setting', {}, this._apiKey));
          this._output(this._applyL2Scan(gen.reply) || '没听明白，请说"记一下"来记录。', 'system');
        } catch (e) {
          this._output('没听明白，请说"记一下"来记录。', 'system');
        }
        this._setState(State.IDLE);
        return { reply: '', state: this._state };
    }
  }

  // ── 录入 ──────────────────────────

  _routeRecord(text, extracted) {
    const key = extracted.key || null;
    const content = extracted.content || '';
    const contentValid = extracted.contentValid !== false;

    this._fields = {
      key: key,
      content: content,
      isTempKey: !key,
    };

    if (!content || !contentValid) {
      this._setState(State.RECORDING_CONTENT);
      this._output(content ? '内容太少了，也给我一句话吧。' : '想记什么？', 'system');
      return { reply: '', state: this._state };
    }

    // Key 硬解析前置（v2.1 新增，零 LLM）：纯数字/单字符/仅标点拦截
    if (this._fields.key && !this._fields.isTempKey) {
      const k = this._fields.key.trim();
      if (/^[\d\s]+$/.test(k) || k.length === 1 || /^[^\u4e00-\u9fa5a-zA-Z]+$/.test(k)) {
        this._output('这个名字不行，至少得有个名词。', 'system');
        this._fields.key = null;
        this._fields.isTempKey = true;
      }
    }

    return this._enterRecTime();
  }

  _enterRecTime() {
    this._setState(State.RECORDING_TIME);
    this._timeRetryCount = 0;
    this._output('这一条什么时候整理？比如说"明天"、"三天后"，或说"默认"。', 'system');
    this._startTimeTimer();
    return { reply: '', state: this._state };
  }

  _startTimeTimer() {
    this._clearTimer();
    this._timeTimer = setTimeout(() => {
      if (this._state === State.RECORDING_TIME) {
        if (this._timeRetryCount === 0) {
          this._timeRetryCount++;
          this._output('没听清～整理时间？明天/默认7天/不提醒。', 'system');
          this._startTimeTimer();
        } else {
          this._saveRecord('default');
        }
      }
    }, 8000);
  }

  async _handleRecContent(text) {
    if (matchWord(text, CANCEL_WORDS)) {
      this._fields = {};
      this._clearTimer();
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    // ── off-task 检测（v2.1 新增：非有效录入内容 → RECORDING_WAIT）──
    this._fields.content = text;
    return this._enterRecTime();
  }

  // ── RECORDING_WAIT（v2.1 新增）──
  _handleRecWait(text) {
    this._clearTimer();
    const t = text.trim().toLowerCase();

    if (t === '继续记' || t === '好' || t === '记') {
      this._setState(State.RECORDING_CONTENT);
      return { reply: '', state: this._state };
    }

    if (t === '不记了' || t === '算了') {
      const offTask = this._fields._offTaskRaw || '';
      this._fields = {};
      this._setState(State.LISTENING);
      if (offTask) return this._handleListening(offTask);
      this._output('好的。', 'system');
      return { reply: '', state: this._state };
    }

    if (matchWord(text, EXIT_WORDS)) {
      this._fields = {};
      this._setState(State.CLOSING);
      setTimeout(() => this._setState(State.IDLE), 2000);
      return { reply: '', state: this._state };
    }

    // 8s 静默回收
    this._timeTimer = setTimeout(() => {
      if (this._state === State.RECORDING_WAIT) {
        this._fields = {};
        this._setState(State.IDLE);
      }
    }, 8000);

    return { reply: '', state: this._state };
  }

  async _handleRecTime(text) {
    this._clearTimer();
    if (matchWord(text, CANCEL_WORDS)) {
      this._fields = {};
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }
    return this._saveRecord(text);
  }

  async _saveRecord(timeStr) {
    const key = this._fields.key;
    const content = this._fields.content;
    const isTemp = !key;

    // 整理时间
    let organizeTime;
    const t = (timeStr || '').trim().toLowerCase();
    if (t === '默认' || t === '随便' || t === 'default') {
      organizeTime = this._defaultTime();
    } else if (t === '永不' || t === '永久' || t === '不整理' || t === '不整理了') {
      organizeTime = 'never';
    } else {
      const parsed = this._parseTime(timeStr);
      organizeTime = parsed || this._defaultTime();
    }

    // Key处理：有就保留，无或格式不符就生成临时Key
    let finalKey = key;
    let isTempKey = isTemp;
    if (finalKey && !this._isValidKey(finalKey)) {
      isTempKey = true;
    }
    if (!finalKey) {
      finalKey = this._genTempKey();
      isTempKey = true;
    }

    const record = {
      name: (finalKey || '').substring(0, 20),
      content: content || '',
      isTemporary: isTempKey,
      skipCount: 0,
      organizeTime,
      attachments: [],
      createdAt: new Date().toISOString(),
    };

    await this._zacuiben.storage.save(record);

    const displayName = isTempKey ? finalKey : key;
    this._output(`已记：${displayName}`, 'done');

    // 附件询问
    this._output('有附件要加吗？没有的话直接说"没有"。', 'system');

    this._fields = {};
    this._setState(State.LISTENING);
    return { reply: '', state: this._state };
  }

  // ── 检索 ──────────────────────────

  _routeSearch(extracted) {
    const key = (extracted.key || '').trim();
    if (!key) {
      this._output('想找什么？请说"找XXX"。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }
    return this._doSearch(key);
  }

  async _doSearch(key) {
    const all = await this._zacuiben.getAllFragments();
    const matches = all.filter(r =>
      (r.name || '').toLowerCase() === key.toLowerCase()
    ).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    if (!matches.length) {
      this._output(`没找到"${key}"，你记过这个名字吗？`, 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    if (matches.length === 1) {
      const r = matches[0];
      const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : '';
      const attCount = (r.attachments || []).length;
      this._output(`找到了：${r.name || ''}——${r.content || ''}，${d}。附件：${attCount}个。`, 'done');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    this._searchResults = matches;
    this._setState(State.SEARCHING);
    this._output(`有几条"${key}"，是昨天的还是哪一天的？`, 'system');
    return { reply: '', state: this._state };
  }

  async _handleSearching(text) {
    const t = text.trim();
    if (t === '算了' || t === '取消') {
      this._searchResults = [];
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }
    if (t === '不确定' || t === '都看看') {
      this._searchResults.forEach(r => {
        const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : '';
        const attCount = (r.attachments || []).length;
        this._output(`${d} ${r.name || ''}——${(r.content||'').slice(0,30)} 附件:${attCount}`, 'result_item');
      });
    } else {
      const matches = this._searchResults.filter(r => {
        const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : '';
        return d.includes(t) || (r.content || '').includes(t);
      });
      if (matches.length) {
        const r = matches[0];
        const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : '';
        this._output(`找到了：${d} ${r.name || ''}——${r.content || ''}`, 'done');
      } else {
        this._output('没找到匹配的。', 'system');
      }
    }
    this._searchResults = [];
    this._setState(State.IDLE);
    return { reply: '', state: this._state };
  }

  // ── 整理 ──────────────────────────

  async _routeOrganize() {
    const all = await this._zacuiben.getAllFragments({ status: 'pending' });
    const allPending = all.filter(r => !r.status || r.status === 'pending');
    if (!allPending.length) {
      this._output('没有需要整理的记录。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    const tempKeys = allPending.filter(r => r.isTemporary);
    const formalKeys = allPending.filter(r => !r.isTemporary);
    tempKeys.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    formalKeys.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    this._orgQueue = [...tempKeys, ...formalKeys];
    this._orgIndex = 0;

    this._setState(State.ORGANIZING);
    return this._showOrgItem();
  }

  _showOrgItem() {
    if (this._orgIndex >= this._orgQueue.length) {
      this._output('整完了。', 'done');
      this._orgQueue = [];
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    const r = this._orgQueue[this._orgIndex];
    const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString('zh-CN') : '';
    const attCount = (r.attachments || []).length;
    const k = this._orgIndex + 1;
    const n = this._orgQueue.length;

    if (r.isTemporary) {
      this._output(
        `未整理（${k}/${n}）。${r.name}——${r.content || ''}，${d}。附件：${attCount}个。还没有正式名字，要起一个吗？`,
        'system'
      );
    } else {
      this._output(
        `未整理（${k}/${n}）。${r.name}——${r.content || ''}，${d}。附件：${attCount}个。好了？`,
        'system'
      );
    }
    return { reply: '', state: this._state };
  }

  async _handleOrganizing(text) {
    const t = text.trim();
    const r = this._orgQueue[this._orgIndex];

    if (t === '退出' || t === '不整了') {
      this._orgQueue = [];
      this._orgIndex = 0;
      this._output('好的。', 'system');
      this._setState(State.IDLE);
      return { reply: '', state: this._state };
    }

    if (r.isTemporary) {
      if (t === '跳过' || t === '先放着' || t === '下一个') {
        const newSkip = (r.skipCount || 0) + 1;
        if (newSkip >= 3) {
          await this._zacuiben.abandonFragment(r.id || r._id);
          this._output('这条已经三次没起名了，自动废弃。', 'system');
        } else {
          await this._zacuiben.storage.update(r.id || r._id, { skipCount: newSkip });
        }
      } else if (t === '删掉' || t === '不要了' || t === '废弃') {
        await this._zacuiben.abandonFragment(r.id || r._id);
        this._output('已废弃。', 'system');
      } else {
        // 当起名处理
        if (this._isValidKey(t)) {
          await this._zacuiben.nameFragment(r.id || r._id, t);
          this._output('已起名。', 'system');
        } else {
          this._output('这个名字不行，至少得有个名词。再想想？', 'system');
          this._setState(State.ORGANIZING);
          return { reply: '', state: this._state };
        }
      }
    } else {
      if (t === '好了' || t === '行了' || t === '下一个') {
        await this._zacuiben.storage.update(r.id || r._id, { status: 'kept', isTemporary: false });
      } else if (t === '跳过' || t === '先放着') {
        // 保持
      } else if (t === '删掉' || t === '不要了' || t === '废弃') {
        await this._zacuiben.abandonFragment(r.id || r._id);
        this._output('已废弃。', 'system');
      } else {
        this._output('可以说"好了"、"跳过"或"废弃"。', 'system');
        this._setState(State.ORGANIZING);
        return { reply: '', state: this._state };
      }
    }

    this._orgIndex++;
    return this._showOrgItem();
  }

  // ── 工具 ──────────────────────────

  _output(text, type) { if (text) this._onOutput(text, type); }

  _label(intent) {
    const m = { record: '记录', search: '检索', organize: '整理', setting: '设置', other: '其他' };
    return m[intent] || intent;
  }

  _genTempKey() {
    const n = Math.floor(Math.random() * 9000) + 1000;
    return `临时-${n}`;
  }

  _defaultTime() {
    const d = new Date();
    d.setDate(d.getDate() + DEFAULT_ORG_DAYS);
    return d.toISOString();
  }

  _parseTime(str) {
    if (!str) return null;
    const s = str.trim();
    if (/^明[天日]$/.test(s)) { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return d.toISOString(); }
    if (/^后[天日]$/.test(s)) { const d = new Date(); d.setDate(d.getDate()+2); d.setHours(9,0,0,0); return d.toISOString(); }
    if (/^(\d+)天[后後]?$/.test(s)) { const d = new Date(); d.setDate(d.getDate()+parseInt(s.match(/\d+/)[0])); d.setHours(9,0,0,0); return d.toISOString(); }
    if (/^(\d+)周[后後]?$/.test(s)) { const d = new Date(); d.setDate(d.getDate()+parseInt(s.match(/\d+/)[0])*7); d.setHours(9,0,0,0); return d.toISOString(); }
    return null;
  }

  _isValidKey(key) { return isValidKey(key); }

  /**
   * LISTENING 态硬嗅探：明显检索/退出 → 跳过 LLM 意图识别（v2.2 新增）。
   * 规则：含检索动词(找/搜/查) + 有目标词 且 无记录动词(记/写/加) → 短路
   */
  _looksLikeSearchOrExit(text) {
    const t = text.trim();
    if (matchWord(t, EXIT_WORDS)) return true;
    // 含记录动词 → 不走短路
    if (/[记写加][了过]|记一下|记个/.test(t)) return false;
    // 明显检索模式：找/搜/查 + 有具体目标
    if (/[找搜查].{1,10}/.test(t) && t.length > 2) return true;
    return false;
  }
}
