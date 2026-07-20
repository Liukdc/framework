// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 环节宪法加载器 — 富贵小安 v5.8
 *
 * 从 L3 JSON 反序列化宪法，注入 LLM prompt。
 * v5.5: @section tools/@section tool_catalog 工具分层声明
 *
 * @module fugui-xiaoan/constitution-sessions-v5.8
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const L3_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'l3-v5.8', 'constitutions');

// ═══ 宪法缓存 ═══════════════════════════════
const _cache = new Map();

function loadJson(name) {
  if (_cache.has(name)) return _cache.get(name);
  const data = JSON.parse(readFileSync(join(L3_DIR, `${name}.json`), 'utf-8'));
  _cache.set(name, data);
  return data;
}

// ═══ prompt 格式化 ═══════════════════════════

function formatPrompt(constitution) {
  const lines = [];
  const c = constitution;
  if (!c) return '';

  lines.push(`<!-- @constitution ${c.constitution} -->`);
  if (c.taskType) lines.push(`<!-- @section taskType -->\n${c.taskType}`);
  if (c.role) lines.push(`<!-- @section role -->\n${c.role}`);
  if (c.convergence) lines.push(`<!-- @section convergence -->\n${c.convergence}`);

  if (c.fieldRules) {
    lines.push(`<!-- @section field-rules -->`);
    if (c.fieldRules.askOrder) lines.push(`必采字段(按顺序): ${c.fieldRules.askOrder.join(' → ')}`);
  }

  if (c.parsing) {
    lines.push(`<!-- @section parsing -->`);
    for (const [field, rule] of Object.entries(c.parsing))
      lines.push(`- ${field}: ${rule}`);
  }

  if (c.validation?.rules?.length) {
    lines.push(`<!-- @section validation -->`);
    for (const r of c.validation.rules)
      lines.push(`- ${r.field}: ${r.type} ${r.min!=null?'min='+r.min:''} ${r.max!=null?'max='+r.max:''}`);
    if (c.validation.requiredFields?.length)
      lines.push(`必填: ${c.validation.requiredFields.join(', ')}`);
  }

  if (c.askRules) lines.push(`<!-- @section ask-rules -->\n${c.askRules}`);
  if (c.completion) lines.push(`<!-- @section completion -->\n${c.completion}`);
  if (c.modification) lines.push(`<!-- @section modification -->\n${c.modification}`);
  if (c.offTaskDetection) lines.push(`<!-- @section off-task-detection -->\n${c.offTaskDetection}`);
  if (c.giveup) lines.push(`<!-- @section giveup -->\n${c.giveup}`);

  if (c.outputSchema) {
    lines.push(`<!-- @section output-schema -->`);
    lines.push(`turnType: ${c.outputSchema.turnType || 'ask|reply|complete|off-task|giveup|validation_failed'}`);
    if (c.outputSchema.askingField)
      lines.push(`askingField: ${c.outputSchema.askingField}`);
    if (c.outputSchema.collectedFields)
      lines.push(`collectedFields: ${JSON.stringify(c.outputSchema.collectedFields)}`);
  }

  if (c.tools?.required?.length) {
    lines.push(`<!-- @section tools -->`);
    lines.push(`必用工具: ${c.tools.required.join(', ')}`);
  }
  if (c.tools?.catalog?.length) {
    lines.push(`<!-- @section tool_catalog -->`);
    lines.push(`选用工具清单: ${c.tools.catalog.join(', ')}`);
  }

  if (c.importance) lines.push(`<!-- @importance -->\n${c.importance}`);

  return lines.join('\n');
}

// ═══ ANALYZING 宪法 ═══════════════════════════

const ANALYZING_PROMPT = `
<!-- @constitution analyzing-session -->
<!-- @section taskType -->
N/A（意图识别环节，不采集字段，不产出turnType）
<!-- @section role -->
你是意图识别环节。将用户输入映射到已知intent（强制选择A/B/C/D/E）：
A=record（记账） B=query（查询） C=delete（删除） D=compare（对比） E=other（无法归类）
并判断输入性质：S=闲聊 T=任务导向 U=不确定
<!-- @section validation -->
choice ∈ {A,B,C,D,E} | intent ∈ {record,query,delete,compare,other} | inputNature ∈ {S,T,U}
<!-- @section output-schema -->
{choice, logprobs, intent, inputNature, extracted}
<!-- @section completion -->
每次输入后返回意图识别结果，调度器按 intent+inputNature 路由
`.trim();

// ═══ 公共 API ═══════════════════════════════

/**
 * 获取环节宪法的 prompt 文本
 * @param {string} intent - record/query/delete/compare/other/SLACK_NODE/analyzing
 * @returns {string}
 */
export function getConstitutionPrompt(intent) {
  if (intent === 'analyzing') return ANALYZING_PROMPT;
  const name = intent === 'SLACK_NODE' ? 'slack-node' : `${intent}-session`;
  try {
    return formatPrompt(loadJson(name));
  } catch {
    return `<!-- @constitution ${name} -->\n宪法文件未找到: ${name}.json`;
  }
}

/**
 * 获取环节宪法的结构化数据
 * @param {string} intent
 * @returns {Object|null}
 */
export function getConstitutionData(intent) {
  const name = intent === 'SLACK_NODE' ? 'slack-node' : `${intent}-session`;
  try { return loadJson(name); } catch { return null; }
}

/**
 * 获取环节的必要工具列表
 * @param {string} intent
 * @returns {{ required: string[], catalog: string[] }}
 */
export function getToolsForIntent(intent) {
  const c = getConstitutionData(intent);
  return {
    required: c?.tools?.required || [],
    catalog: c?.tools?.catalog || [],
  };
}

/**
 * 验证宪法是否包含所有必需的 @section 标签
 * @returns {{ passed: boolean, violations: string[] }}
 */
export function validateAllConstitutions() {
  const required = ['taskType', 'role', 'outputSchema', 'offTaskDetection', 'tools'];
  const violations = [];
  const intents = ['record', 'query', 'delete', 'compare', 'other', 'SLACK_NODE'];

  for (const intent of intents) {
    const c = getConstitutionData(intent);
    if (!c) { violations.push(`${intent}: 宪法文件缺失`); continue; }
    for (const tag of required) {
      // other-session 是路由分发器(N/A), 不需要 offTaskDetection/taskType
      if (intent === 'other' && (tag === 'offTaskDetection' || tag === 'taskType')) continue;
      if (!c[tag] && !(intent === 'SLACK_NODE' && tag === 'taskType')) {
        violations.push(`${intent}: 缺少 @section ${tag}`);
      }
    }
  }

  return { passed: violations.length === 0, violations };
}
