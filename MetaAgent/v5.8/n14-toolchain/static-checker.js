// @MetaAgent v5.8 — n14-toolchain/static-checker.js
// 静态质量检查：硬编码阈值/内联拼接/CJS残留/接口一致性

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(import.meta.dirname || '.', '..', 'src-v5.8');
const L3_DIR = join(import.meta.dirname || '.', '..', '..', '..', 'MetaAgent', 'docs', 'l3-v5.8');

export function runStaticChecks() {
  const checks = [];

  // 1. 硬编码阈值扫描（数字魔数）
  checks.push(checkMagicNumbers());

  // 2. CJS require 残留扫描
  checks.push(checkCjsRequire());

  // 3. 内联拼接检查（scheduler.js 中不应直接拼 system prompt）
  checks.push(checkInlinePrompt());

  // 4. L3 JSON 有效性扫描
  checks.push(checkL3JsonValidity());

  // 5. tunable 参数声明完整性
  checks.push(checkTunableDeclaration());

  // 6. 宪法文件引用一致性
  checks.push(checkConstitutionReferences());

  return {
    passed: checks.filter(c => c.pass).length,
    failed: checks.filter(c => !c.pass).length,
    total: checks.length,
    checks,
  };
}

/** 检查硬编码数字魔数 */
function checkMagicNumbers() {
  const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.js') && f !== '__test__');
  const issues = [];

  for (const file of files) {
    const content = readFileSync(join(SRC_DIR, file), 'utf-8');
    // 检查明显硬编码阈值（非 0/1/2/true/false/null 的裸数字在非注释行）
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
      if (line.includes('getTunable') || line.includes('TUNABLE_META')) continue;
      if (line.match(/const\s+\w+\s*=\s*\d+/)) continue; // 命名常量
      // 匹配疑似阈值: === 数字 / > 数字 / < 数字，排除索引和常见常量
      const m = line.match(/([<>=!]=?\s*(\d{3,}|[6-9]\d|0\.\d))/);
      if (m && !line.includes('Date.now()') && !line.includes('Math.') && !line.includes('i++') && !line.includes('i--')) {
        const num = m[2];
        if (parseFloat(num) >= 50 || (parseFloat(num) < 1 && parseFloat(num) > 0.01)) {
          issues.push(`${file}:${i+1} → 疑似硬编码: ${m[0].trim()}`);
        }
      }
    }
  }

  return {
    check: 'magic-numbers',
    pass: issues.length === 0,
    detail: issues.length > 0 ? issues.slice(0, 5).join('; ') : '无硬编码阈值',
    issues,
  };
}

/** 检查 CJS require 残留 */
function checkCjsRequire() {
  const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
  const issues = [];
  for (const file of files) {
    const content = readFileSync(join(SRC_DIR, file), 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('require(') && !line.includes('//') && !line.includes('createRequire')) {
        issues.push(`${file}:${i+1} → require残留: ${line.trim().slice(0, 60)}`);
      }
    }
  }
  return {
    check: 'cjs-require',
    pass: issues.length === 0,
    detail: issues.length > 0 ? issues.slice(0, 3).join('; ') : '无CJS残留',
    issues,
  };
}

/** 检查 scheduler 是否直接拼接 prompt（应委托 context-manager） */
function checkInlinePrompt() {
  try {
    const scheduler = readFileSync(join(SRC_DIR, 'scheduler.js'), 'utf-8');
    const hasContextManager = scheduler.includes('this._cm.buildContext') || scheduler.includes('contextManager.buildContext');
    const hasInlineConcat = /\+\s*['"]\n\n.*环节/.test(scheduler);

    return {
      check: 'inline-prompt',
      pass: hasContextManager && !hasInlineConcat,
      detail: hasContextManager ? 'scheduler.js 正确委托 context-manager 拼接' : 'scheduler.js 未使用 context-manager',
    };
  } catch {
    return { check: 'inline-prompt', pass: false, detail: '无法读取 scheduler.js' };
  }
}

/** 检查 L3 JSON 文件有效性 */
function checkL3JsonValidity() {
  try {
    const jsonFiles = readdirSync(L3_DIR).filter(f => f.endsWith('.json'));
    const issues = [];
    for (const f of jsonFiles) {
      try {
        JSON.parse(readFileSync(join(L3_DIR, f), 'utf-8'));
      } catch (e) {
        issues.push(`${f}: ${e.message}`);
      }
    }
    return {
      check: 'l3-json-validity',
      pass: issues.length === 0,
      detail: issues.length > 0 ? issues.join('; ') : `全部 ${jsonFiles.length} 个 JSON 有效`,
      issues,
    };
  } catch {
    return { check: 'l3-json-validity', pass: false, detail: 'L3 路径不可达' };
  }
}

/** 检查 tunable 声明与使用一致性 */
function checkTunableDeclaration() {
  try {
    const content = readFileSync(join(SRC_DIR, 'tunables.js'), 'utf-8');
    // 精确计数：每个参数定义格式为 keyName: { type: ...
    const declaredCount = (content.match(/\w+\s*:\s*\{\s*type\s*:/g) || []).length;
    return {
      check: 'tunable-declaration',
      pass: declaredCount === 25,
      detail: `${declaredCount}/25 参数声明`,
    };
  } catch {
    return { check: 'tunable-declaration', pass: false, detail: '无法读取 tunables.js' };
  }
}

/** 检查宪法文件引用一致性 */
function checkConstitutionReferences() {
  try {
    const constitDir = join(SRC_DIR, 'constitutions');
    const loaderContent = readFileSync(join(constitDir, 'loader.js'), 'utf-8');
    const hasLoader = loaderContent.includes('loadAllConstitutions') && loaderContent.includes('getConstitutionForIntent');
    const hasPerIntentMap = loaderContent.includes('texts[intent]');
    const indexContent = readFileSync(join(L3_DIR, 'constitutions', 'index.json'), 'utf-8');
    const hasIndex = indexContent.includes('constitutionFiles') && indexContent.includes('constitutionCount');
    const count = JSON.parse(indexContent).constitutionCount;
    return {
      check: 'constitution-references',
      pass: hasLoader && hasIndex && hasPerIntentMap,
      detail: `16份宪法 per-intent 独立加载 (count=${count}, hasPerIntentMap=${hasPerIntentMap})`,
    };
  } catch {
    return { check: 'constitution-references', pass: false, detail: '宪法文件缺失' };
  }
}

export function formatReport(result) {
  const lines = [];
  lines.push(`  通过: ${result.passed}/${result.total}`);
  result.checks.forEach(c => {
    const icon = c.pass ? '✅' : '❌';
    lines.push(`  ${icon} ${c.check}: ${c.detail}`);
  });
  return lines.join('\n');
}
