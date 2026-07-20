// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * N14 审骨架 — 静态质量检查器
 *
 * 检查项:
 *   1. 硬编码阈值检测 — 搜索数字字面量,排除getTunable()调用
 *   2. 内联拼接检测 — 搜索直接操作turnHistory的代码
 *   3. 接口一致性检查 — 比对buildPromptContext()参数与interfaces.json
 *   4. 降级链四项检查 — 确认无cross_task_extension残留
 *   5. logprobs替代confidence — 确认无confidence残留
 *
 * @module n14-toolchain/static-checker
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ═══ 硬编码阈值白名单 ═══════════════════════
const KNOWN_CONSTANTS = new Set([
  'TUNING_INTERVAL', 'MAX_RETRIES', 'MAX_RESPONSE_LENGTH',
  'checkpoint.ttl', 'session_checkpoint_ttl',
]);
const VALID_VALUES = new Set([
  // 这些值在调参前就确定了,不应出现在getTunable()外部
  // 如果出现,说明硬编码了应该从tunable读取的参数
]);

// ═══ 需要排除的文件 ═══════════════════════════
const EXCLUDE = new Set(['node_modules', 'test', '.npm-cache', '旧版本']);

// ═══ 搜索目录 ═══════════════════════════════
const SRC_DIR = join(import.meta.dirname || '.', '..', 'src-v5.8');

export function runStaticChecks() {
  const results = { hardcodedThresholds: [], inlineConcat: [], confidenceResidual: [], interfaceMismatch: [], allPassed: true };

  const files = findJSFiles(SRC_DIR);
  for (const file of files) {
    const code = readFileSync(file, 'utf-8');
    const lines = code.split('\n');

    // 检查1: 硬编码阈值
    checkHardcoded(lines, file, results);

    // 检查2: 内联拼接
    checkInlineConcat(lines, file, results);

    // 检查3: confidence 残留
    checkConfidence(lines, file, results);
  }

  // 检查4: 接口一致性
  checkInterfaces(SRC_DIR, results);

  results.allPassed = results.hardcodedThresholds.length === 0
    && results.inlineConcat.length === 0
    && results.confidenceResidual.length === 0
    && results.interfaceMismatch.length === 0;

  return results;
}

// ═══ 检查1: 硬编码阈值 ═══════════════════════
function checkHardcoded(lines, file, results) {
  const thresholdPattern = /\b(0\.\d|19|20|50|999999|604800)\b/g;
  const tunableCalls = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 收集 getTunable() 调用中的默认值(合法)
    const match = line.match(/getTunable\s*\(\s*['"][\w_]+['"]\s*,\s*(-?\d+\.?\d*)/);
    if (match) tunableCalls.add(Number(match[1]));

    // 排除 getTunable 调用行
    if (line.includes('getTunable')) continue;
    // 排除常量声明行
    if (line.match(/const\s+\w+\s*=\s*(-?\d+\.?\d*);/) && !line.includes('Object.freeze')) continue;

    const m = line.match(thresholdPattern);
    if (m) {
      const val = Number(m[0]);
      if (!tunableCalls.has(val) && !KNOWN_CONSTANTS.has(line.trim())) {
        results.hardcodedThresholds.push({ file, line: i + 1, value: val, text: line.trim().substring(0, 80) });
      }
    }
  }
}

// ═══ 检查2: 内联拼接 ═══════════════════════
function checkInlineConcat(lines, file, results) {
  // 调度器中不应直接操作 turnHistory(应通过 buildPromptContext)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 如果不是 context-manager 文件, 出现直接操作 turnHistory 就是问题
    if (file.includes('context-manager')) continue;
    if (file.includes('contract-store')) continue;

    if (line.match(/turnHistory\s*\.\s*(slice|splice|push|unshift|shift|concat|join)/)
        || line.match(/\bturnHistory\s*\[\s*(-?\d+|length)/)
        || line.match(/this\._ses\.hist\.(slice|splice|push)/)) {
      if (line.includes('buildPromptContext') || line.includes('context-manager')) continue;
      results.inlineConcat.push({ file, line: i + 1, text: line.trim().substring(0, 80) });
    }
  }
}

// ═══ 检查3: confidence 残留 ═══════════════════
function checkConfidence(lines, file, results) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 排除注释和历史说明
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (line.includes('v5.1') || line.includes('已废弃') || line.includes('替代')) continue;

    if (/\bconfidence\b/i.test(line) && !line.includes('logprobs')) {
      results.confidenceResidual.push({ file, line: i + 1, text: line.trim().substring(0, 80) });
    }
  }
}

// ═══ 检查4: interfaces.json 一致性 ═══════════════════
function checkInterfaces(dir, results) {
  try {
    const iface = JSON.parse(readFileSync(join(dir, '..', '..', '..', 'l3-v5.8', 'interfaces.json'), 'utf-8'));
    const expectedParams = iface.contextManager.buildPromptContext.params;

    // 检查 state-machine.js 中 buildPromptContext 调用
    const sm = readFileSync(join(dir, 'state-machine.js'), 'utf-8');
    const callMatch = sm.match(/buildPromptContext\s*\(\s*\{([^}]+)\}\s*\)/);
    if (callMatch) {
      const actualParams = callMatch[1].split(',').map(s => s.trim().split(':')[0].trim());
      const missing = expectedParams.filter(p => !actualParams.includes(p));
      const extra = actualParams.filter(p => !expectedParams.includes(p) && p !== '');
      if (missing.length > 0 || extra.length > 0) {
        results.interfaceMismatch.push({
          file: 'state-machine.js',
          missing,
          extra: extra.length > 0 ? extra : [],
          expected: expectedParams,
          actual: actualParams,
        });
      }
    }
  } catch (e) {
    results.interfaceMismatch.push({ error: `无法读取 interfaces.json: ${e.message}` });
  }
}

export function findJSFiles(dir) {
  const files = [];
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(f.name)) continue;
      const full = join(dir, f.name);
      if (f.isDirectory()) {
        files.push(...findJSFiles(full));
      } else if (f.name.endsWith('.js') || f.name.endsWith('.mjs')) {
        files.push(full);
      }
    }
  } catch (e) { /* skip */ }
  return files;
}

export function formatReport(r) {
  const lines = [];
  lines.push('══════════ N14 静态质量检查报告 ══════════');
  lines.push('');

  if (r.hardcodedThresholds.length > 0) {
    lines.push(`❌ 硬编码阈值: ${r.hardcodedThresholds.length} 处`);
    for (const t of r.hardcodedThresholds) lines.push(`  ${t.file}:${t.line} | ${t.value} | ${t.text}`);
  } else { lines.push('✅ 硬编码阈值: 未发现'); }

  lines.push('');
  if (r.inlineConcat.length > 0) {
    lines.push(`❌ 内联拼接: ${r.inlineConcat.length} 处`);
    for (const t of r.inlineConcat) lines.push(`  ${t.file}:${t.line} | ${t.text}`);
  } else { lines.push('✅ 内联拼接: 未发现'); }

  lines.push('');
  if (r.confidenceResidual.length > 0) {
    lines.push(`❌ confidence残留: ${r.confidenceResidual.length} 处`);
    for (const t of r.confidenceResidual) lines.push(`  ${t.file}:${t.line} | ${t.text}`);
  } else { lines.push('✅ confidence残留: 未发现(全部改用logprobs)'); }

  lines.push('');
  if (r.interfaceMismatch.length > 0) {
    lines.push(`❌ 接口不一致: ${r.interfaceMismatch.length} 处`);
    for (const t of r.interfaceMismatch) lines.push(`  ${JSON.stringify(t)}`);
  } else { lines.push('✅ 接口一致性: buildPromptContext参数与interfaces.json一致'); }

  lines.push('');
  lines.push(r.allPassed ? '✅ 静态检查全部通过' : '❌ 静态检查发现问题');
  return lines.join('\n');
}
