// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 PWA — v2.0 对话版（严格按完整流程规格）
 *
 * 使用 DialogueEngine 驱动全对话流程：
 *   "小安出来记一下" → 唤醒 → 说话 → 追问 → 记账 → 循环
 */
import { FuguiXiaoan, createLocalStorage, DialogueEngine, DialogueState, toCSV, toJSON, download, getApiKey, setApiKey } from './lib/index.js';

let xiaoan;
let engine;
let _storage = null;
let _mode = 'simple'; // 'simple' | 'detailed'

// ═══ 启动 ═══════════════════════════════════════

async function init() {
  // 等待原生桥接初始化完成（避免竞态）
  if (window.__bridgeReady) await window.__bridgeReady;

  const caps = window.__nativeCapabilities;

  // 原生模式：等 bridge 初始化完成后用 SQLite
  if (caps?.storage) {
    const { NativeBridge } = window;
    // NativeSQLiteStorage — 实现 FuguiXiaoan 期望的 StorageBackend 接口
    _storage = {
      save: async (r) => {
        const saved = await NativeBridge.storage.save(r);
        return { ...saved, id: saved.id || saved._id };
      },
      query: (f) => NativeBridge.storage.query(f),
      all: () => NativeBridge.storage.getAll(),
      remove: (id) => NativeBridge.storage.delete(id),
      clear: async () => {
        const all = await NativeBridge.storage.getAll();
        for (const r of all) await NativeBridge.storage.delete(r.id || r._id);
      },
      getCount: async () => { const s = await NativeBridge.storage.getStats(); return s.total; },
      getStats: async () => { const s = await NativeBridge.storage.getStats(); return { total: s.total, sum: s.sum }; },
    };
    xiaoan = new FuguiXiaoan({ storage: _storage, mode: _mode });
    console.log('[富贵小安] 原生 SQLite 存储已启用');
    initEngine();
    showMain();
    return;
  }

  // Web 模式：原有 PWA 逻辑（CloudBase 或 localStorage）
  const envId = localStorage.getItem('fugui_cloudbase_envid');

  if (envId) {
    let waited = 0;
    while (!window.cloudbase && waited < 5000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
    if (window.cloudbase) {
      try {
        const { CloudBaseStorage } = await import('./lib/cloudbase-storage.js');
        const app = window.cloudbase.init({ env: envId });
        _storage = new CloudBaseStorage({ app });
        await _storage.init();
        const b = document.getElementById('cloudBadge');
        if (b) { b.style.display = 'flex'; b.textContent = '☁️ 云端'; }
        xiaoan = new FuguiXiaoan({ storage: _storage, mode: _mode });
      } catch (e) {
        console.warn('CloudBase fail', e);
        fallbackLocal();
      }
    } else { fallbackLocal(); }
  } else { fallbackLocal(); }

  if (!xiaoan) fallbackLocal();
  initEngine();
  showMain();
}

function fallbackLocal() {
  _storage = createLocalStorage('fugui_pwa');
  xiaoan = new FuguiXiaoan({ storage: _storage, mode: _mode });
}

// ═══ 对话引擎 ════════════════════════════════════

function initEngine() {
  const apiKey = getApiKey();

  engine = new DialogueEngine({
    xiaoan,
    mode: _mode,
    apiKey: apiKey || null,
    onOutput: (text, type) => { if (text) appendBubble(text, type); },
    onStateChange: (state) => {
      updateModeLabel();
      const input = document.getElementById('chatInput');
      if (state === DialogueState.IDLE) {
        input.placeholder = '说『小安出来记一下』叫醒我';
      } else if (state === DialogueState.LISTENING) {
        input.placeholder = '想记什么？直接说…';
      } else if (state === DialogueState.CLARIFYING) {
        input.placeholder = '请回答…';
      }
    }
  });
}

// ═══ UI ═══════════════════════════════════════════

function showMain() {
  _mode = localStorage.getItem('fugui_mode') || 'simple';
  engine.setMode(_mode);
  updateModeLabel();

  // 不支持语音就隐藏按钮
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
    var vb = document.getElementById('voiceBtn');
    if (vb) vb.style.display = 'none';
  }

  const visited = localStorage.getItem('fugui_visited');
  if (!visited) { setTimeout(() => document.getElementById('onboarding').classList.add('show'), 600); }

  // API Key 检测：没配就提示
  if (!getApiKey()) {
    appendBubble('⚠️ 小安还没接上大脑。请点底部的「⚙️设置」→ 填入 DeepSeek API Key。', 'system');
  }
}

function updateModeLabel() {
  const h1 = document.getElementById('headerTitle');
  const st = engine ? engine.state : 'idle';
  if (_mode === 'simple') {
    h1.innerHTML = '<span style="color:#E8A840">小安</span> · 简单';
  } else {
    h1.innerHTML = '<span style="color:#14B8A6">小安</span> · 细致';
  }
}

function appendBubble(text, type) {
  if (!text) return;
  const list = document.getElementById('chatList');
  const div = document.createElement('div');
  const isUser = type === 'user';
  div.className = 'chat-bubble ' + (isUser ? 'user' : 'system');
  if (type === 'done') div.classList.add('done');
  if (type === 'thinking') div.innerHTML = '<span class="dot-pulse">…</span>';
  else div.textContent = text;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;

  // 如果 type 是 result_item，不需要单独的气泡，直接追加到上一条 done 气泡
  if (type === 'result_item') {
    const prev = list.querySelector('.chat-bubble.done:last-child');
    if (prev) {
      prev.textContent += '\n' + text;
    }
    return;
  }
}

// ═══ 用户输入 ═════════════════════════════════════

window.sendMessage = async function() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  appendBubble(text, 'user');
  input.value = '';

  const result = await engine.handleInput(text);
  // 如果引擎要求确认删除
  if (result.confirmDelete && result.record) {
    const ok = confirm('确认要删除吗？');
    if (ok) await engine.confirmDelete(result.record);
    else appendBubble('好的，不删了。', 'system');
  }
};

window.handleKey = function(e) {
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
};

// ═══ 语音 ═════════════════════════════════════════

let voiceActive = false, _rec = null;

function _voiceSupported() {
  // 原生模式：SpeechToText 插件已注册
  if (window.__nativeCapabilities?.native) return true;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

window.toggleVoice = function() {
  if (!_voiceSupported()) {
    toast('此浏览器不支持语音，请打字');
    return;
  }
  voiceActive ? stopVoice() : startVoice();
};

function startVoice() {
  // 原生模式：用 Capacitor SpeechToText 插件（系统离线识别）
  if (window.__nativeCapabilities?.native) {
    _startNativeVoice();
    return;
  }
  // Web 模式：webkitSpeechRecognition
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('语音不可用，请打字'); return; }
  if (_rec) { try { _rec.abort(); } catch(e) {} _rec = null; }
  const r = new SR();
  r.lang = 'zh-CN';
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    let t = '';
    for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
    document.getElementById('chatInput').value = t;
    if (e.results[0].isFinal) {
      stopVoice();
      document.getElementById('chatInput').focus();
      setTimeout(() => { if (window.sendMessage) sendMessage(); }, 300);
    }
  };
  r.onerror = (e) => {
    stopVoice();
    const errs = { 'not-allowed': '请允许麦克风权限', 'no-speech': '未听到声音，请重试', 'network': '网络错误', 'aborted': '' };
    const msg = errs[e.error] || '语音不可用，请打字';
    if (msg) toast(msg);
  };
  r.onend = () => {
    document.getElementById('voiceBtn').classList.remove('listening');
    voiceActive = false;
  };
  _rec = r;
  try {
    r.start();
    voiceActive = true;
    document.getElementById('voiceBtn').classList.add('listening');
  } catch(e) {
    voiceActive = false;
    toast('语音启动失败，请打字');
  }
}

function stopVoice() {
  if (_rec) { try { _rec.stop(); } catch(e) {} _rec = null; }
  voiceActive = false;
  document.getElementById('voiceBtn').classList.remove('listening');
}

// 原生语音识别（Capacitor SpeechToText 插件）
async function _startNativeVoice() {
  voiceActive = true;
  document.getElementById('voiceBtn').classList.add('listening');
  try {
    await window.NativeBridge.voice.start(
      (text) => {
        // 识别完成
        document.getElementById('chatInput').value = text;
        stopVoice();
        document.getElementById('chatInput').focus();
        setTimeout(() => { if (window.sendMessage) sendMessage(); }, 300);
      },
      (err) => {
        // 识别失败
        stopVoice();
        toast('未识别到语音，请重试');
      }
    );
  } catch (e) {
    stopVoice();
    toast('语音启动失败，请打字');
  }
}

// ═══ 设置 ═════════════════════════════════════════

window.toggleMode = function() {
  _mode = _mode === 'simple' ? 'detailed' : 'simple';
  localStorage.setItem('fugui_mode', _mode);
  engine.setMode(_mode);
  updateModeLabel();
  toast(_mode === 'simple' ? '已切换为简单模式' : '已切换为细致模式');
};

window.showCloudSettings = function() {
  document.getElementById('cloudPanel').classList.toggle('show');
  if (document.getElementById('cloudPanel').classList.contains('show')) {
    document.getElementById('tcbEnvId').value = localStorage.getItem('fugui_cloudbase_envid') || '';
  }
};
window.saveCloudConfig = function() {
  const v = document.getElementById('tcbEnvId').value.trim();
  if (!v) return toast('请填入环境 ID');
  localStorage.setItem('fugui_cloudbase_envid', v);
  document.getElementById('cloudPanel').classList.remove('show');
  toast('已保存，刷新生效');
  setTimeout(() => location.reload(), 1000);
};

window.showApiKeyPanel = function() {
  document.getElementById('apiKeyPanel').classList.toggle('show');
  const i = document.getElementById('apiKeyInput');
  i.value = getApiKey() || '';
  if (document.getElementById('apiKeyPanel').classList.contains('show')) i.focus();
};
window.saveApiKey = function() {
  const k = document.getElementById('apiKeyInput').value.trim();
  if (!k) return toast('请输入 Key');
  setApiKey(k);
  document.getElementById('apiKeyPanel').classList.remove('show');
  toast('已保存，刷新后生效');
  setTimeout(() => location.reload(), 1000);
};

window.exportCSV = async function() { await doExport('csv'); };
window.exportJSON = async function() { await doExport('json'); };
async function doExport(format) {
  const all = await xiaoan.getAllRecords();
  if (!all.length) return toast('没有数据');
  const c = format === 'json' ? toJSON(all, true) : toCSV(all);
  download(c, `fugui-xiaoan-${new Date().toISOString().slice(0,10)}.${format}`, format === 'json' ? 'application/json' : 'text/csv');
  toast(format.toUpperCase() + ' 导出成功');
}

window.clearAll = function() {
  if (confirm('清空全部？不可恢复。')) xiaoan.clearAll().then(() => toast('已清空'));
};

window.dismissOnboarding = function() {
  document.getElementById('onboarding').classList.remove('show');
  localStorage.setItem('fugui_visited', '1');
};
window.toggleHelp = function() { document.getElementById('helpPopup').classList.toggle('show'); };

// ═══ 统计页 ═══════════════════════════════════════

window.refreshStats = async function() {
  const all = await xiaoan.getAllRecords(); const now = new Date();
  const thisMonth = all.filter(r => { const d = new Date(r.date || r.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  document.getElementById('statCount').textContent = thisMonth.length;
  const total = thisMonth.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  document.getElementById('statTotal').textContent = total.toFixed(0);

  const cats = {}, colors = ['#E8A840', '#3B82F6', '#22C55E', '#EF4444', '#8B5CF6', '#F59E0B'];
  thisMonth.forEach(r => { const c = r.category || r.name || '其他'; cats[c] = (cats[c] || 0) + (parseFloat(r.amount) || 0); });
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const html = entries.map(([c, amt], i) => {
    const safeCat = c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return `<div class="cat-row"><span>${safeCat}</span><div class="bar-bg"><div class="bar-fill" style="width:${(amt/total*100).toFixed(0)}%;background:${colors[i%colors.length]}"></div></div><span>¥${amt.toFixed(0)}</span></div>`;
  }).join('') || '<div class="empty"><p>暂无数据</p></div>';
  document.getElementById('catBreakdown').innerHTML = html;

  const weekDiv = document.getElementById('weekChart'), days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }); const amt = all.filter(r => { const rd = new Date(r.date || r.createdAt); return rd.toDateString() === d.toDateString(); }).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0); days.push({ label: k.split('/')[1] || k, amt }); }
  const maxAmt = Math.max(1, ...days.map(d => d.amt));
  weekDiv.innerHTML = days.map(d => `<div class="bar-col"><div class="bar" style="height:${(d.amt/maxAmt*100).toFixed(0)}%"></div><div class="day">${d.label}</div></div>`).join('');
};

function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }

init();
