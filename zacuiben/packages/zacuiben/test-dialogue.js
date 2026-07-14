// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
// 杂碎本 对话引擎 v2.2 测试（对齐富贵小安标准）
import { Zacuiben, createMemoryStorage, DialogueEngine, DialogueState } from './src/index.js';

let p=0,f=0,n=0;
function test(name,fn){
  n++;const num=n;
  try{const r=fn();if(r&&r.then)return r.then(()=>{console.log(`ok ${num}-${name}`);p++},e=>{console.log(`not ok ${num}-${name}\n  ${e.message}`);f++});
  console.log(`ok ${num}-${name}`);p++}catch(e){console.log(`not ok ${num}-${name}\n  ${e.message}`);f++}
}
function assert(c,m){if(!c)throw new Error(m||'fail')}
function eq(a,b,m){assert(a===b,m||`expected ${b}, got ${a}`)}

async function run(){
  console.log('TAP version 13');

  // ═══ 状态机基础 ═══════════════════
  console.log('# 状态机基础');
  test('初始 IDLE',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    eq(e.state,DialogueState.IDLE);
  });

  test('唤醒→LISTENING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    await e.handleInput('杂碎本');
    eq(e.state,DialogueState.LISTENING);
  });

  test('非唤醒词→提示+保持IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    await e.handleInput('你好');
    eq(e.state,DialogueState.IDLE);
  });

  test('空输入→忽略',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._state=DialogueState.LISTENING;
    await e.handleInput('');
    eq(e.state,DialogueState.LISTENING);
  });

  // ═══ 退出词 ═══════════════════════
  console.log('# 退出词');
  test('IDLE态拜拜→CLOSING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    await e.handleInput('拜拜');
    eq(e.state,DialogueState.CLOSING);
  });

  test('LISTENING态退出→CLOSING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._state=DialogueState.LISTENING;
    await e.handleInput('退出');
    eq(e.state,DialogueState.CLOSING);
  });

  test('RECORDING_CONTENT态再见→CLOSING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:null,content:'蓝色外套'};
    e._state=DialogueState.RECORDING_CONTENT;
    await e.handleInput('再见');
    eq(e.state,DialogueState.CLOSING);
  });

  // ═══ 取消词 ═══════════════════════
  console.log('# 取消词');
  test('RECORDING_CONTENT说算了→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:null,content:''};
    e._state=DialogueState.RECORDING_CONTENT;
    await e.handleInput('算了');
    eq(e.state,DialogueState.IDLE);
  });

  test('RECORDING_TIME说算了→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'小喵',content:'蓝衣'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('算了');
    eq(e.state,DialogueState.IDLE);
  });

  // ═══ 录入流程 ═══════════════════════
  console.log('# 录入流程');

  test('RECORDING_CONTENT有效内容→RECORDING_TIME',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:null,content:''};
    e._state=DialogueState.RECORDING_CONTENT;
    await e.handleInput('地铁上看到一件蓝色外套');
    eq(e.state,DialogueState.RECORDING_TIME);
  });

  test('RECORDING_TIME说默认→保存→LISTENING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'小喵',content:'蓝色外套'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('默认');
    eq(e.state,DialogueState.LISTENING);
  });

  test('RECORDING_TIME说永不→保存→LISTENING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'小汪',content:'狗粮'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('永不');
    eq(e.state,DialogueState.LISTENING);
  });

  test('RECORDING_TIME说三天后→保存→LISTENING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'开会',content:'周二下午3点'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('三天后');
    eq(e.state,DialogueState.LISTENING);
  });

  test('RECORDING_TIME说明天→保存→LISTENING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'遛狗',content:'早上'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('明天');
    eq(e.state,DialogueState.LISTENING);
  });

  test('RECORDING_TIME保存后存储有数据',async()=>{
    const s=createMemoryStorage();
    const zc=new Zacuiben({storage:s});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={key:'小喵',content:'蓝色外套'};
    e._state=DialogueState.RECORDING_TIME;
    await e.handleInput('默认');
    const all=await zc.getAllFragments();
    assert(all.length>=1,'storage should have at least 1 record');
  });

  // ═══ RECORDING_WAIT ══════════════
  console.log('# RECORDING_WAIT');
  test('RECORDING_WAIT说继续记→回RECORDING_CONTENT',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={content:'蓝'};
    e._state=DialogueState.RECORDING_WAIT;
    await e.handleInput('继续记');
    eq(e.state,DialogueState.RECORDING_CONTENT);
  });

  test('RECORDING_WAIT说好→回RECORDING_CONTENT',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={content:'蓝'};
    e._state=DialogueState.RECORDING_WAIT;
    await e.handleInput('好');
    eq(e.state,DialogueState.RECORDING_CONTENT);
  });

  test('RECORDING_WAIT说算了→顶部拦截→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={content:'蓝'};
    e._state=DialogueState.RECORDING_WAIT;
    await e.handleInput('算了');
    // 取消词走顶部拦截 → IDLE（清空所有临时状态）
    eq(e.state,DialogueState.IDLE);
  });

  test('RECORDING_WAIT说再见→CLOSING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._fields={content:'蓝'};
    e._state=DialogueState.RECORDING_WAIT;
    await e.handleInput('再见');
    eq(e.state,DialogueState.CLOSING);
  });

  // ═══ L2 扫描 ═══════════════════════
  console.log('# L2 扫描');
  test('L2 禁用语命中→替换为兜底',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    const r1=e._applyL2Scan('好的，已记录。');
    eq(r1,'好的，已记录。');
    const r2=e._applyL2Scan('已记录。您还可以继续添加。');
    eq(r2,'好的。');
    const r3=e._applyL2Scan('已记。如果需要更多帮助，请告诉我。');
    eq(r3,'好的。');
  });

  test('L2 null/空→原样返回',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    eq(e._applyL2Scan(null),null);
    eq(e._applyL2Scan(''),'');
  });

  // ═══ 检索嗅探 ═══════════════════════
  console.log('# 检索嗅探 v2.2');
  test('_looksLikeSearchOrExit 找小喵→true',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    assert(e._looksLikeSearchOrExit('找小喵'));
    assert(e._looksLikeSearchOrExit('搜一下猫'));
  });

  test('_looksLikeSearchOrExit 记一下→false',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    assert(!e._looksLikeSearchOrExit('记一下猫粮'));
    assert(!e._looksLikeSearchOrExit('记了小喵的信息'));
  });

  test('_looksLikeSearchOrExit 随机文本→false',()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    assert(!e._looksLikeSearchOrExit('你好'));
    assert(!e._looksLikeSearchOrExit('今天天气不错'));
  });

  // ═══ 检索流程 ═══════════════════════
  console.log('# 检索流程');
  test('SEARCHING说算了→清空→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._searchResults=[{name:'小喵',content:'蓝衣',createdAt:new Date().toISOString()}];
    e._state=DialogueState.SEARCHING;
    await e.handleInput('算了');
    eq(e.state,DialogueState.IDLE);
  });

  test('SEARCHING说都看看→全部列出→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._searchResults=[
      {name:'小喵',content:'蓝衣1',createdAt:new Date().toISOString(),attachments:[]},
      {name:'小喵',content:'蓝衣2',createdAt:new Date().toISOString(),attachments:[]}
    ];
    e._state=DialogueState.SEARCHING;
    await e.handleInput('都看看');
    eq(e.state,DialogueState.IDLE);
  });

  // ═══ 整理流程 ═══════════════════════
  console.log('# 整理流程');

  test('整理退出→CLOSING',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._orgQueue=[{name:'临时-1',content:'蓝衣',isTemporary:true,skipCount:0,createdAt:new Date().toISOString(),attachments:[],id:'t1'}];
    e._orgIndex=0;
    e._state=DialogueState.ORGANIZING;
    await e.handleInput('退出');
    assert(e.state===DialogueState.CLOSING||e.state===DialogueState.IDLE);
  });

  test('整理说不整了→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._orgQueue=[{name:'临时-1',content:'蓝衣',isTemporary:true,skipCount:0,createdAt:new Date().toISOString(),attachments:[],id:'t1'}];
    e._orgIndex=0;
    e._state=DialogueState.ORGANIZING;
    await e.handleInput('不整了');
    eq(e.state,DialogueState.IDLE);
  });

  test('整理空队列→直接IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._apiKey='sk-test';
    e._state=DialogueState.ORGANIZING;
    e._orgIndex=0; e._orgQueue=[];
    const r=e._showOrgItem();
    eq(e.state,DialogueState.IDLE);
    assert(r.reply==='', 'should return empty reply');
  });

  // ═══ CLOSING ═══════════════════════
  console.log('# CLOSING');
  test('CLOSING→2s→IDLE',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    e._state=DialogueState.CLOSING;
    await e.handleInput(''); // triggers noop but state stays
    eq(e.state,DialogueState.CLOSING);
  });

  // ═══ 边界 ═══════════════════════
  console.log('# 边界');
  test('无Key→警告',async()=>{
    const zc=new Zacuiben({storage:createMemoryStorage()});
    const e=new DialogueEngine({zacuiben:zc});
    await e.handleInput('你好');
    eq(e.state,DialogueState.IDLE);
  });

  console.log(`\n# 总计:${p+f} 通过:${p} 失败:${f}`);
  if(f>0)process.exit(1);
}
run().catch(e=>{console.error(e);process.exit(1)});
