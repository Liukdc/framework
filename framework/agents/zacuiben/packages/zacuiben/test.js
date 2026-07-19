// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 杂粹本 — 完整测试套件
 *
 * 自包含测试框架：ESM import + assert + TAP 输出，零依赖，node 直接运行。
 *
 * 用法：
 *   node test.js
 *
 * @module zacuiben/test
 */

import { Zacuiben, MemoryStorage, createMemoryStorage, LocalStorageStorage, SessionState, RecordStatus } from './src/index.js';
import { CleanupSession } from './src/session.js';

// ═══════════════════════════════════════════════════════════
// TAP 测试框架
// ═══════════════════════════════════════════════════════════

let tests = 0;
let passed = 0;
let failed = 0;

function ok(condition, message) {
  tests++;
  if (condition) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: truthy`);
    console.log(`  actual:   ${condition}`);
    console.log(`  ...`);
  }
}

function equal(actual, expected, message) {
  tests++;
  if (actual === expected) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    console.log(`  ...`);
  }
}

function deepEqual(actual, expected, message) {
  tests++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: ${b}`);
    console.log(`  actual:   ${a}`);
    console.log(`  ...`);
  }
}

function notEqual(actual, expected, message) {
  tests++;
  if (actual !== expected) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: not ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    console.log(`  ...`);
  }
}

function isNull(actual, message) {
  tests++;
  if (actual === null) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: null`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    console.log(`  ...`);
  }
}

function isNotNull(actual, message) {
  tests++;
  if (actual !== null && actual !== undefined) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: not null/undefined`);
    console.log(`  actual:   ${actual}`);
    console.log(`  ...`);
  }
}

function throws(fn, message) {
  tests++;
  try {
    fn();
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected: function to throw`);
    console.log(`  actual:   no throw`);
    console.log(`  ...`);
  } catch (e) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  }
}

function contains(str, substring, message) {
  tests++;
  if (str && str.includes(substring)) {
    passed++;
    console.log(`ok ${tests} - ${message}`);
  } else {
    failed++;
    console.log(`not ok ${tests} - ${message}`);
    console.log(`  ---`);
    console.log(`  expected to contain: ${JSON.stringify(substring)}`);
    console.log(`  actual string:       ${JSON.stringify(str)}`);
    console.log(`  ...`);
  }
}

// ═══════════════════════════════════════════════════════════
// Mock localStorage（Node.js 环境）
// ═══════════════════════════════════════════════════════════

function createLocalStorageMock() {
  const store = {};
  const mock = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
    get length() {
      return Object.keys(store).length;
    },
    key(index) {
      return Object.keys(store)[index] || null;
    },
  };
  return mock;
}

// ═══════════════════════════════════════════════════════════
// 主测试入口
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('TAP version 14');

  await testTypes();
  await testStorageMemory();
  await testStorageLocalStorage();
  await testRecordFlow();
  await testSearchFlow();
  await testCleanupFlow();
  await testSession();
  await testProtector();

  // ── 最终统计 ──
  console.log(`1..${tests}`);
  console.log(`\n# ${passed}/${tests} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════
// 1. types.js 常量值验证 (~6)
// ═══════════════════════════════════════════════════════════

function testTypes() {
  console.log('\n# ===== types.js — 常量值验证 =====');

  // SessionState
  equal(SessionState.IDLE, 'idle', 'SessionState.IDLE === "idle"');
  equal(SessionState.ACTIVE, 'active', 'SessionState.ACTIVE === "active"');
  equal(SessionState.COMPLETED, 'completed', 'SessionState.COMPLETED === "completed"');

  // RecordStatus
  equal(RecordStatus.PENDING, 'pending', 'RecordStatus.PENDING === "pending"');
  equal(RecordStatus.KEPT, 'kept', 'RecordStatus.KEPT === "kept"');
  equal(RecordStatus.DELETED, 'deleted', 'RecordStatus.DELETED === "deleted"');
  equal(RecordStatus.ARCHIVED, 'archived', 'RecordStatus.ARCHIVED === "archived"');
  equal(RecordStatus.ABANDONED, 'abandoned', 'RecordStatus.ABANDONED === "abandoned" (v1.0 新增)');

  // 冻结验证
  ok(Object.isFrozen(SessionState), 'SessionState 对象已冻结');
  ok(Object.isFrozen(RecordStatus), 'RecordStatus 对象已冻结');
}

// ═══════════════════════════════════════════════════════════
// 2. storage.js — MemoryStorage (~10)
// ═══════════════════════════════════════════════════════════

async function testStorageMemory() {
  console.log('\n# ===== storage.js — MemoryStorage =====');

  const store = new MemoryStorage();

  // --- save ---
  const r1 = await store.save({ content: '第一条碎片', name: '碎片1' });
  isNotNull(r1.id, 'save() 返回的记录含 id');
  ok(r1.id.startsWith('frag_'), 'id 以 frag_ 开头');
  equal(r1.content, '第一条碎片', 'save() 保留 content');
  equal(r1.status, 'pending', 'save() 默认 status=pending');
  ok(typeof r1.createdAt === 'string', 'save() 自动生成 createdAt');

  const r2 = await store.save({ content: '第二条碎片', isProtected: true, status: 'kept' });
  equal(r2.isProtected, true, 'save() 保留 isProtected=true');
  equal(r2.status, 'kept', 'save() 保留自定义 status');

  // --- getById ---
  const found = await store.getById(r1.id);
  isNotNull(found, 'getById() 找到已保存记录');
  equal(found.content, '第一条碎片', 'getById() 返回正确记录');

  const notFound = await store.getById('nonexistent');
  isNull(notFound, 'getById() 找不到返回 null');

  // --- all ---
  const all = await store.all();
  ok(all.length >= 2, 'all() 返回所有记录 (>=2)');
  // 按 createdAt 倒序排列
  ok(new Date(all[0].createdAt) >= new Date(all[1].createdAt), 'all() 按 createdAt 倒序排列');

  // --- query (via all + filter) ---
  const kept = all.filter(r => r.status === 'kept');
  equal(kept.length, 1, 'all() + filter 模拟 query — 找到 1 条 kept');
  equal(kept[0].id, r2.id, 'query 过滤结果 id 正确');

  // --- remove ---
  const removed = await store.remove(r1.id);
  ok(removed, 'remove() 删除成功返回 true');
  const afterRemove = await store.getById(r1.id);
  isNull(afterRemove, 'remove() 后 getById 返回 null');

  const notRemoved = await store.remove('nonexistent');
  equal(notRemoved, false, 'remove() 不存在的 id 返回 false');

  // --- removePermanently ---
  const permRemoved = await store.removePermanently(r2.id);
  ok(permRemoved, 'removePermanently() 返回 true');
  const afterPerm = await store.getById(r2.id);
  isNull(afterPerm, 'removePermanently() 后记录不存在');

  // --- _recycleBin ---
  ok(store._recycleBin instanceof Map, '_recycleBin 是一个 Map');
  equal(store._recycleBin.size, 0, '_recycleBin 初始为空');

  // --- clear ---
  const r3 = await store.save({ content: '清空测试' });
  await store.clear();
  const afterClear = await store.all();
  equal(afterClear.length, 0, 'clear() 后 all() 返回空数组');
}

// ═══════════════════════════════════════════════════════════
// 3. storage.js — LocalStorageStorage (~8)
// ═══════════════════════════════════════════════════════════

async function testStorageLocalStorage() {
  console.log('\n# ===== storage.js — LocalStorageStorage =====');

  // 安装 mock
  const lsMock = createLocalStorageMock();
  globalThis.localStorage = lsMock;

  const store = new LocalStorageStorage('test_zacuiben');

  // --- save ---
  const r1 = await store.save({ content: 'LS 碎片一', name: '测试1' });
  isNotNull(r1.id, '[LS] save() 返回含 id 的记录');
  equal(r1.content, 'LS 碎片一', '[LS] save() 保留 content');
  equal(r1.isTemporary, false, '[LS] save() 默认 isTemporary=false');
  equal(r1.skipCount, 0, '[LS] save() 默认 skipCount=0');

  const r2 = await store.save({ content: 'LS 碎片二', isTemporary: true, status: 'pending' });
  equal(r2.isTemporary, true, '[LS] save() 保留 isTemporary=true');

  // --- getById ---
  const found = await store.getById(r1.id);
  equal(found.content, 'LS 碎片一', '[LS] getById() 返回正确记录');

  const notFound = await store.getById('no-such-id');
  isNull(notFound, '[LS] getById() 找不到返回 null');

  // --- all ---
  const all = await store.all();
  ok(all.length >= 2, '[LS] all() 返回所有记录');

  // --- update ---
  const updated = await store.update(r1.id, { status: 'kept' });
  equal(updated.status, 'kept', '[LS] update() 更新 status');
  const recheck = await store.getById(r1.id);
  equal(recheck.status, 'kept', '[LS] update() 持久化生效');

  // --- remove ---
  await store.remove(r2.id);
  const afterRemove = await store.getById(r2.id);
  isNull(afterRemove, '[LS] remove() 后 getById 返回 null');

  // --- removePermanently ---
  // 先添加再永久删除
  const r3 = await store.save({ content: '将被永久删除' });
  await store.removePermanently(r3.id);
  const afterPerm = await store.getById(r3.id);
  isNull(afterPerm, '[LS] removePermanently() 后记录不存在');

  // --- clear ---
  await store.clear();
  const afterClear = await store.all();
  equal(afterClear.length, 0, '[LS] clear() 后 all() 返回空数组');

  // 清理 mock
  delete globalThis.localStorage;
}

// ═══════════════════════════════════════════════════════════
// 4. index.js — 录入流程 (~10)
// ═══════════════════════════════════════════════════════════

async function testRecordFlow() {
  console.log('\n# ===== index.js — 录入流程 =====');

  const zc = new Zacuiben();

  // --- record: 召唤指令 + Key--Content 格式 ---
  const res1 = zc.record('杂碎本，记一下：小喵——地铁上看到的');
  equal(res1.type, 'record', '召唤指令识别 type=record');
  ok(res1.name.includes('小喵'), '召唤指令解析 Key 含"小喵"');
  equal(res1.content, '地铁上看到的', '召唤指令正确提取 Content');
  equal(res1.isTemporary, false, '有 Key 时 isTemporary=false');
  // 等待存储完成
  const saved1 = await res1._savePromise;
  isNotNull(saved1.id, '召唤指令记录已保存到存储');

  // --- record: 直接 Key——Content 格式 ---
  const res2 = zc.record('小喵——一件蓝色外套');
  equal(res2.name, '小喵', 'Key 解析正确');
  equal(res2.content, '一件蓝色外套', 'Content 解析正确');
  equal(res2.isTemporary, false, '有 Key 时 isTemporary=false');

  // --- record: 纯文本无 Key → 临时记录 ---
  const res3 = zc.record('地铁上看到的');
  equal(res3.type, 'record', '纯文本 type=record');
  equal(res3.name, '临时-1', '第一个临时 Key 为"临时-1"');
  equal(res3.content, '地铁上看到的', '临时记录 content 保留');
  equal(res3.isTemporary, true, '纯文本 isTemporary=true');

  const res4 = zc.record('又看到一只猫');
  equal(res4.name, '临时-2', '第二个临时 Key 为"临时-2"');
  equal(res4.isTemporary, true, '连续临时记录 isTemporary=true');

  // --- record: Key 格式验证 — 纯数字拒绝 ---
  const res5 = zc.record('12345——测试内容');
  equal(res5.isTemporary, true, '纯数字 Key 被拒绝 → 降级为临时记录');
  ok(res5.name.startsWith('临时-'), '纯数字 Key 降级为临时 Key');

  // --- record: Key 格式验证 — 纯标点拒绝 ---
  const res6 = zc.record('，。！——测试内容');
  equal(res6.isTemporary, true, '纯标点 Key 被拒绝 → 降级为临时记录');
  ok(res6.name.startsWith('临时-'), '纯标点 Key 降级为临时 Key');

  // --- record: 空内容抛出 ---
  throws(() => zc.record(''), 'record("") 抛出错误');
  throws(() => zc.record('   '), 'record("   ") 抛出错误');

  // --- setOrganizeTime ---
  const res7 = zc.record('笔记本——工作需要');
  const saved7 = await res7._savePromise;

  // 设置一个有效的整理时间
  const orgResult = await zc.setOrganizeTime(saved7.id, '7天');
  equal(orgResult.success, true, 'setOrganizeTime("7天") 返回 success=true');
  ok(
    orgResult.organizeTime && orgResult.organizeTime.endsWith('Z') || orgResult.organizeTime.includes('T'),
    'setOrganizeTime 返回 ISO 日期格式'
  );
  notEqual(orgResult.organizeTime, 'never', 'setOrganizeTime("7天") 不是 "never"');

  // --- setOrganizeTime: 永不 ---
  const res8 = zc.record('灵感——稍纵即逝');
  const saved8 = await res8._savePromise;
  const neverResult = await zc.setOrganizeTime(saved8.id, '永不');
  equal(neverResult.success, true, 'setOrganizeTime("永不") 返回 success=true');
  equal(neverResult.organizeTime, 'never', 'setOrganizeTime("永不") → "never"');

  // --- setOrganizeTime: 无效 id ---
  const badResult = await zc.setOrganizeTime('nonexistent', '7天');
  equal(badResult.success, false, 'setOrganizeTime 无效 id 返回 success=false');
  ok(badResult.error.includes('不存在'), 'setOrganizeTime 无效 id 返回错误信息');

  // --- addFragment: 正常添加 ---
  const frag = await zc.addFragment('看到一篇好文章');
  equal(frag.content, '看到一篇好文章', 'addFragment 保存 content');
  equal(frag.status, 'pending', 'addFragment 默认 status=pending');
  isNotNull(frag.id, 'addFragment 返回含 id 的记录');

  // --- addFragment: 空内容抛出 ---
  try {
    await zc.addFragment('');
    ok(false, 'addFragment("") 应抛出错误');
  } catch (e) {
    ok(e.message.includes('不能为空'), 'addFragment("") 抛出"不能为空"');
  }
}

// ═══════════════════════════════════════════════════════════
// 5. index.js — 检索流程 (~5)
// ═══════════════════════════════════════════════════════════

async function testSearchFlow() {
  console.log('\n# ===== index.js — 检索流程 =====');

  const zc = new Zacuiben();

  // 使用 addFragment（name 取自 content 前20字）
  // 这样 search 的 Key 匹配 = content 前缀匹配
  const r1 = await zc.addFragment('小喵在地铁站看到一只橘猫');
  const r2 = await zc.addFragment('小喵在小区楼下又看到那只猫');
  const r3 = await zc.addFragment('灵感反分类是一种新思路');

  // 验证存储后 name 字段（MemoryStorage.save 用 content 作为 name）
  ok(r1.name.startsWith('小喵'), '存储后 name 取自 content 前缀');

  // --- 精确/包含匹配：name 包含查询词 ---
  const results = await zc.search('小喵');
  ok(results.length >= 2, 'search("小喵") name包含匹配返回 >=2 条');

  // 精确匹配排最前（name === query 的排最前）
  // 由于 name 取自 content 前20字，精确匹配需要 content 等于查询词
  const exactResult = await zc.search('灵感反分类是一种新思路');
  ok(exactResult.length >= 1, 'search(完整content) 精确匹配返回结果');

  // --- 搜索不存在的内容 ---
  const empty = await zc.search('不存在的');
  equal(empty.length, 0, 'search("不存在的") 返回空数组');

  // --- 多记录同名全部返回 ---
  ok(results.length >= 2, 'name包含"小喵"的记录全部返回（2条）');

  // --- Key 包含匹配 ---
  const resInclude = await zc.search('灵感');
  ok(resInclude.length >= 1, 'search("灵感") 按 name 包含匹配返回结果');

  // --- 全文拆词匹配 ---
  const resFullText = await zc.search('橘猫');
  ok(resFullText.length >= 1, 'search("橘猫") 全文拆词匹配返回结果');
  const matched = resFullText.some(r => (r.content || '').includes('橘猫'));
  ok(matched, '全文匹配结果包含关键词"橘猫"');

  // --- search 空查询 ---
  const emptyQuery = await zc.search('');
  equal(emptyQuery.length, 0, 'search("") 返回空数组');
}

// ═══════════════════════════════════════════════════════════
// 6. index.js — 整理清理流程 (~10)
// ═══════════════════════════════════════════════════════════

async function testCleanupFlow() {
  console.log('\n# ===== index.js — 整理清理流程 =====');

  const zc = new Zacuiben();

  // 准备数据：正式Key + 临时Key
  const r1 = zc.record('工作——完成报告');
  const s1 = await r1._savePromise;
  const r2 = zc.record('灵感——新项目想法');
  const s2 = await r2._savePromise;
  const r3 = zc.record('随便写的一句话');
  const s3 = await r3._savePromise; // 临时 Key
  const r4 = zc.record('又一句');
  const s4 = await r4._savePromise; // 临时 Key

  // --- startCleanup: 临时Key排在正式Key前面 ---
  const session = await zc.startCleanup();
  isNotNull(session, 'startCleanup() 返回会话对象');
  equal(session.state, 'active', 'startCleanup() 后状态为 active');

  const progress = session.getProgress();
  equal(progress.total, 4, 'getProgress().total = 4');
  equal(progress.current, 0, 'getProgress().current = 0（尚未处理）');

  // 验证第一个是临时Key
  const first = session.current();
  isNotNull(first, 'current() 返回第一条碎片');
  ok(first.record.isTemporary, 'startCleanup() 临时Key排在第一位');

  // --- skipFragment (via Zacuiben) ---
  const skip1 = await zc.skipFragment(s1.id);
  equal(skip1.success, true, 'skipFragment 成功');
  equal(skip1.skipCount, 1, 'skipFragment 第一次 skipCount=1');
  equal(skip1.becameAbandoned, false, 'skipCount<3 不废弃');

  const skip2 = await zc.skipFragment(s1.id);
  equal(skip2.skipCount, 2, 'skipFragment 第二次 skipCount=2');
  equal(skip2.becameAbandoned, false, 'skipCount=2 仍不废弃');

  const skip3 = await zc.skipFragment(s1.id);
  equal(skip3.skipCount, 3, 'skipFragment 第三次 skipCount=3');
  equal(skip3.becameAbandoned, true, 'skipCount≥3 → becameAbandoned=true');
  equal(skip3.record.status, RecordStatus.ABANDONED, 'skipCount≥3 自动标记 status=abandoned');

  // --- abandonFragment ---
  const abandon = await zc.abandonFragment(s2.id);
  equal(abandon.success, true, 'abandonFragment 成功');
  equal(abandon.record.status, RecordStatus.ABANDONED, 'abandonFragment → status=abandoned');

  // --- nameFragment: 给临时 Key 命名 ---
  const nameResult = await zc.nameFragment(s3.id, '日记');
  equal(nameResult.success, true, 'nameFragment 成功');
  equal(nameResult.record.isTemporary, false, 'nameFragment 后 isTemporary=false');
  equal(nameResult.record.status, RecordStatus.KEPT, 'nameFragment 后 status=kept');

  // nameFragment: 无效 Key 格式
  const nameBad = await zc.nameFragment(s4.id, '123');
  equal(nameBad.success, false, 'nameFragment 无效Key格式返回 success=false');
  ok(nameBad.error.includes('格式无效'), 'nameFragment 无效Key返回错误信息');

  // --- checkAutoCleanup: 废弃记录进回收区 ---
  const cleanupResult = await zc.checkAutoCleanup();
  ok(cleanupResult.movedToRecycleBin >= 2, 'checkAutoCleanup 废弃记录移入回收区 (≥2)');
  ok(zc.storage._recycleBin.size >= 2, '回收区包含被废弃的记录');

  // --- recoverFromBin: 恢复废弃记录 ---
  const recover = await zc.recoverFromBin(s2.id);
  equal(recover.success, true, 'recoverFromBin 成功');
  equal(recover.record.status, RecordStatus.PENDING, 'recoverFromBin 恢复后 status=pending');

  // --- recoverFromBin: 回收区无记录 ---
  const recoverBad = await zc.recoverFromBin('nonexistent');
  equal(recoverBad.success, false, 'recoverFromBin 无效id返回 success=false');
  ok(recoverBad.error.includes('未找到'), 'recoverFromBin 无效id返回错误信息');

  // --- getStats ---
  const stats = await zc.getStats();
  ok(typeof stats.totalFragments === 'number', 'getStats 返回 totalFragments');
  ok(stats.pendingFragments >= 0, 'getStats 包含 pendingFragments');
  ok('abandonedFragments' in stats, 'getStats 包含 abandonedFragments');
}

// ═══════════════════════════════════════════════════════════
// 7. session.js — 会话交互 (~8)
// ═══════════════════════════════════════════════════════════

async function testSession() {
  console.log('\n# ===== session.js — 会话交互 =====');

  const store = new MemoryStorage();

  // 准备数据（注：MemoryStorage.save name 取自 content 前20字）
  const temp = await store.save({
    name: '临时-1',
    content: '临时-1在地铁站看到的灵感',
    isTemporary: true,
    status: 'pending',
  });
  const formal = await store.save({
    name: '工作',
    content: '工作明天要提交报告',
    isTemporary: false,
    status: 'pending',
  });
  const another = await store.save({
    name: '阅读',
    content: '阅读《反分类》第三章笔记',
    isTemporary: false,
    status: 'pending',
  });

  const session = new CleanupSession(store, [temp, formal, another]);
  const startResult = session.start();
  equal(startResult, 'started', 'session.start() 返回 "started"');

  // --- current(): 临时Key展示格式 ---
  const curr1 = session.current();
  isNotNull(curr1, 'current() 返回当前碎片');
  ok(curr1.displayText.includes('未整理'), 'current() 展示文本含"未整理"');
  ok(curr1.displayText.includes('临时-1'), 'current() 展示文本含临时Key名');
  ok(
    curr1.displayText.includes('还没有正式名字'),
    'current() 临时Key展示含"还没有正式名字"'
  );
  ok(
    curr1.displayText.includes('在地铁站看到的灵感'),
    'current() 展示文本含 content 文本'
  );

  // --- decide('skip') ---
  const skipRes = await session.decide('skip');
  equal(skipRes.action, 'skip', 'decide("skip") action=skip');
  ok(skipRes.record.skipCount >= 1, 'decide("skip") 后 skipCount 递增');
  // skipCount=1, 不废弃 (skipCount < 3)
  ok(skipRes.record.status !== RecordStatus.ABANDONED || skipRes.record.skipCount >= 3,
    'skipCount<3 不触发 ABANDONED');

  // --- current() 正式Key展示格式 ---
  const curr2 = session.current();
  isNotNull(curr2, 'current() 前进到正式Key记录');
  ok(!curr2.record.isTemporary, 'current() 正式Key记录 isTemporary=false');
  ok(curr2.displayText.includes('工作'), 'current() 正式Key展示含 Key 名');
  ok(curr2.displayText.includes('好了？'), 'current() 正式Key展示含"好了？"');

  // --- decide('delete') ---
  const delRes = await session.decide('delete');
  equal(delRes.action, 'delete', 'decide("delete") action=delete');
  equal(delRes.record.status, RecordStatus.DELETED, 'decide("delete") → status=deleted');

  // --- decide('keep') ---
  const keepRes = await session.decide('keep');
  equal(keepRes.action, 'keep', 'decide("keep") action=keep');
  equal(keepRes.record.status, RecordStatus.KEPT, 'decide("keep") → status=kept');

  // --- 会话完成 ---
  equal(session.state, SessionState.COMPLETED, '处理完所有记录后状态=COMPLETED');
  ok(!keepRes.hasMore, '最后一条 hasMore=false');

  // --- nameTemp ---
  // 新建一个会话测试 nameTemp
  const temp2 = await store.save({
    name: '临时-2',
    content: '新的临时碎片',
    isTemporary: true,
    status: 'pending',
  });
  const session2 = new CleanupSession(store, [temp2]);
  session2.start();

  const nameRes = await session2.nameTemp(temp2.id, '笔记');
  equal(nameRes.success, true, 'nameTemp 成功');
  equal(nameRes.record.isTemporary, false, 'nameTemp 后 isTemporary=false');
  equal(nameRes.record.name, '笔记', 'nameTemp 后 Key 更新为"笔记"');

  const nameBad = await session2.nameTemp(temp2.id, '12345');
  equal(nameBad.success, false, 'nameTemp 无效Key返回 success=false');

  // --- getProgress ---
  const prog = session.getProgress();
  equal(prog.total, 3, 'getProgress().total=3');
  equal(prog.kept, 1, 'getProgress().kept=1');
  equal(prog.deleted, 1, 'getProgress().deleted=1');
  equal(prog.remaining, 0, 'getProgress().remaining=0');
}

// ═══════════════════════════════════════════════════════════
// 8. protector.js — 保护管理 (~4)
// ═══════════════════════════════════════════════════════════

async function testProtector() {
  console.log('\n# ===== protector.js — 保护管理 =====');

  const store = new MemoryStorage();
  const rec = await store.save({ content: '重要灵感', isProtected: false, status: 'pending' });

  const zc = new Zacuiben({ storage: store });

  // --- protectFragment ---
  const prot = await zc.protectFragment(rec.id);
  isNotNull(prot, 'protectFragment 返回更新后的记录');
  equal(prot.isProtected, true, 'protectFragment → isProtected=true');

  // --- verifyDelete: 受保护记录不允许删除 ---
  const verify1 = await zc.verifyDelete(rec.id);
  equal(verify1.allowed, false, 'verifyDelete 受保护记录 allowed=false');
  ok(verify1.reason.includes('重要'), 'verifyDelete 受保护记录返回原因含"重要"');

  // --- unprotectFragment ---
  const unprotected = await zc.unprotectFragment(rec.id);
  equal(unprotected.isProtected, false, 'unprotectFragment → isProtected=false');

  const verify2 = await zc.verifyDelete(rec.id);
  equal(verify2.allowed, true, 'verifyDelete 取消保护后 allowed=true');

  // --- verifyDelete: 不存在的记录 ---
  const verify3 = await zc.verifyDelete('nonexistent-id');
  equal(verify3.allowed, false, 'verifyDelete 不存在记录 allowed=false');
  ok(verify3.reason.includes('不存在'), 'verifyDelete 不存在记录返回原因含"不存在"');

  // --- protectFragment: 不存在的 id ---
  const badProtect = await zc.protectFragment('nonexistent');
  isNull(badProtect, 'protectFragment 无效id返回 null');
}

// ═══════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════

main().catch((err) => {
  console.error(`\n# FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
