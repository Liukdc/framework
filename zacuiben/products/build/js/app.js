// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
import { Zacuiben, createMemoryStorage } from './lib/index.js';

const zc = new Zacuiben({ storage: createMemoryStorage('zcb_full') });
let cleanupSession = null;

// ── Record ──
window.doRecord = async function() {
  const key = document.getElementById('keyInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!content) { toast('请输入内容'); return; }
  const text = key ? `${key}——${content}` : content;
  const result = zc.record(text);
  if (result._savePromise) await result._savePromise;
  toast(result.isTemporary ? '已记录（临时名称）' : '已记录');
  document.getElementById('keyInput').value = '';
  document.getElementById('contentInput').value = '';
  refreshAll();
};

// ── List ──
async function loadRecords() {
  const stats = zc.getStats();
  document.getElementById('fragCount').textContent = (stats.total || 0) + ' 条';
  const all = await zc.storage.all();
  const list = document.getElementById('recordList');
  const empty = document.getElementById('emptyRec');
  if (!all.length) { list.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  list.innerHTML = all.slice(0,20).map(r => {
    const isTemp = r.isTemporary; const isAbandoned = r.status === 'abandoned';
    const cls = isTemp ? 'temp' : ''; const tag = isAbandoned ? '<span class="tag del-tag">已废弃</span>' : isTemp ? '<span class="tag temp-tag">临时</span>' : r.status === 'kept' ? '<span class="tag keep-tag">已确认</span>' : '';
    return `<div class="frag-card"><div class="key ${cls}">${r.name||'(无名称)'}${tag}</div><div class="content">${r.content||''}</div><div class="meta"><span>${fmtDate(r.createdAt)}</span>${r.skipCount>0?`<span style="color:var(--amber)">跳过${r.skipCount}次</span>`:''}</div></div>`;
  }).join('');
}

// ── Search ──
window.doSearch = async function() {
  const q = document.getElementById('searchBox').value.trim();
  if (!q) { document.getElementById('searchList').innerHTML=''; document.getElementById('emptySearch').style.display='block'; return; }
  const results = await zc.search(q);
  const list = document.getElementById('searchList');
  const empty = document.getElementById('emptySearch');
  if (!results.length) { list.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  list.innerHTML = results.map(r => `<div class="frag-card"><div class="key">${r.name||''}</div><div class="content">${r.content||''}</div><div class="meta"><span>${fmtDate(r.createdAt)}</span></div></div>`).join('');
};

// ── Cleanup ──
async function loadCleanup() {
  cleanupSession = await zc.startCleanup();
  renderCleanupCard();
}

function renderCleanupCard() {
  const area = document.getElementById('cleanupArea');
  if (!cleanupSession) { area.innerHTML='<div class="empty"><div class="icon">🧹</div><p>没有需要整理的碎片</p></div>'; return; }
  const cur = cleanupSession.current();
  if (!cur) { area.innerHTML='<div class="empty"><div class="icon">✅</div><p>全部整理完毕！</p></div>'; cleanupSession=null; return; }
  const r = cur.record || cur; const prog = cleanupSession.getProgress();
  const display = cur.displayText || `${r.name||'(无名称)'} —— ${(r.content||'').substring(0,60)}`;
  area.innerHTML = `<div class="cleanup-card"><div style="font-size:12px;color:var(--tx3);margin-bottom:8px">整理 ${prog.current}/${prog.total}</div><div class="prompt">${display}</div><div class="actions"><button class="btn-keep" onclick="cleanDecide('keep')">保留</button><button class="btn-delete" onclick="cleanDecide('abandon')">废弃</button><button class="btn-skip" onclick="cleanDecide('skip')">跳过</button>${r.isTemporary?`<button class="btn-name" onclick="promptName()">起名</button>`:''}</div></div>`;
}

window.cleanDecide = async function(action) {
  if (action === 'abandon') { await zc.abandonFragment(cleanupSession.current().record?.id); }
  await cleanupSession.decide(action === 'abandon' ? 'skip' : action);
  renderCleanupCard();
};

window.promptName = async function() {
  const id = cleanupSession.current().record?.id;
  if (!id) return;
  const name = prompt('起个名字：');
  if (!name) return;
  await cleanupSession.nameTemp(id, name);
  renderCleanupCard(); toast('已命名');
};

// ── Settings ──
window.exportJSON = async function() {
  const all = await zc.storage.all();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zacuiben.json'; a.click(); toast('已导出');
};
window.importJSON = function() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text(); const data = JSON.parse(text);
    for (const r of data) { zc.record(r.name ? `${r.name}——${r.content}` : r.content); }
    toast(`已导入 ${data.length} 条`); refreshAll();
  }; input.click();
};
window.clearAll = function() {
  if (confirm('确定清空全部碎片？不可恢复。')) { zc.storage.clear(); toast('已清空'); refreshAll(); }
};

// ── Helpers ──
function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2000); }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}); }

async function refreshAll() {
  await loadRecords();
  // periodic auto-clean
  try { await zc.checkAutoCleanup(); } catch(e) {}
}

// Init
loadRecords();
setTimeout(loadCleanup, 500);
