// @MetaAgent v5.8 — det-validator.js
// DET 确定性校验引擎——prompt 宪法只提供统计性引导，这里的代码提供确定性约束
// 每个房间的环节宪法 @section validation JSON 规则，由这个文件逐条执行，不依赖 LLM

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTunable } from './tunables.js';

export class DETValidator {
  constructor(constitutionDir, tunables = {}) {
    this._constDir = constitutionDir;
    this._tunables = tunables;
  }

  /** 加载环节宪法的 validation 规则 */
  _loadRules(intent) {
    try {
      const files = [
        `${intent}_环节宪法_v5.8.md`,
        `${intent}_环节宪法_v8.7.md`,
        `${intent}_环节宪法_v1.8.md`,
        `${intent}_环节宪法_v2.0.md`,
        `${intent}_环节宪法_v1.6.md`,
        `${intent}_环节宪法_v1.5.md`,
        `${intent}_环节宪法_v1.2.md`,
        `${intent}_环节宪法_v1.0.md`,
      ];
      for (const f of files) {
        try {
          const path = join(this._constDir, f);
          const text = readFileSync(path, 'utf-8');
          return this._parseValidationSection(text);
        } catch { /* try next */ }
      }
    } catch { /* no constitution found */ }
    return null;
  }

  /** 从宪法文本提取 @section validation JSON */
  _parseValidationSection(text) {
    const match = text.match(/<!-- @section validation -->\s*\[值域校验规则\][\s\S]*?```json\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch { return null; }
  }

  /** 主入口：对模型输出执行全部 DET 校验 */
  validate(intent, parsed, taskType) {
    const issues = [];

    // === 根宪法第1条：relevance 评分前置检查 ===
    const THRESHOLD = getTunable(this._tunables, 'relevanceThreshold');
    if (parsed.relevance !== null && parsed.relevance !== undefined && parsed.relevance < THRESHOLD) {
      return {
        valid: false,
        offTask: true,
        message: `DET 拦截：模型对「${intent}」的匹配度评分=${parsed.relevance}/100（<${THRESHOLD}），转入 ANALYZING 重新识别。`,
        issues: [{ field: 'relevance', issue: `评分 ${parsed.relevance} < ${THRESHOLD}`, severity: 'block' }],
      };
    }
    if (parsed.relevance === undefined || parsed.relevance === null) {
      issues.push({ field: 'relevance', issue: '根宪法第1条要求输出 {relevance: 0-100}', severity: 'warn' });
    }

    // === 通用校验（所有房间都要过的） ===

    // 1. turnType 必须是合法值
    const validTurnTypes = ['ask', 'reply', 'complete', 'off-task', 'giveup', 'validation_failed'];
    if (parsed.turnType && !validTurnTypes.includes(parsed.turnType)) {
      issues.push({ field: 'turnType', issue: `非法值: ${parsed.turnType}`, severity: 'block' });
    }

    // 2. content 非空（除 off-task 外）
    if (parsed.turnType !== 'off-task' && parsed.turnType !== 'giveup') {
      if (!parsed.content || parsed.content.trim().length === 0) {
        issues.push({ field: 'content', issue: '输出为空', severity: 'block' });
      }
    }

    // 3. validation_failed 必须带 validationResult
    if (parsed.turnType === 'validation_failed' && !parsed.validationResult) {
      issues.push({ field: 'validationResult', issue: 'turnType=validation_failed 但 validationResult 为空', severity: 'block' });
    }

    // 4. off-task 必须带 offTaskInput
    if (parsed.turnType === 'off-task' && !parsed.offTaskInput) {
      issues.push({ field: 'offTaskInput', issue: 'turnType=off-task 但 offTaskInput 为空', severity: 'block' });
    }

    // 5. changeLevel + changeLevelReason 一致性
    if (parsed.changeLevel === 'major' || parsed.changeLevel === 'minor') {
      if (!parsed.changeLevelReason || parsed.changeLevelReason.trim().length === 0) {
        issues.push({ field: 'changeLevelReason', issue: 'changeLevel=major/minor 必须附带 changeLevelReason', severity: 'warn' });
      } else if (parsed.changeLevelReason.length > 100) {
        issues.push({ field: 'changeLevelReason', issue: 'changeLevelReason 超过 100 字', severity: 'warn' });
      }
    }

    // === 加载环节宪法规则 ===
    const rules = this._loadRules(intent);
    if (rules && parsed.turnType === 'complete') {
      for (const rule of rules.rules || []) {
        const fieldValue = this._getField(parsed, rule.field);
        if (fieldValue === undefined) {
          if (rule.type === 'required' || rules.required_fields?.includes(rule.field)) {
            issues.push({ field: rule.field, issue: rule.error_tag || '字段缺失', severity: 'block' });
          }
        }
      }
    }

    const blockers = issues.filter(i => i.severity === 'block');
    const warnings = issues.filter(i => i.severity === 'warn');

    if (blockers.length > 0) {
      return {
        valid: false,
        message: `❌ DET 校验未通过：\n${blockers.map((e,i) => `  ${i+1}. [${e.field}] ${e.issue}`).join('\n')}${warnings.length > 0 ? '\n⚠️ 警告：\n' + warnings.map((e,i) => `  ⚠ ${e.field}: ${e.issue}`).join('\n') : ''}`,
        issues: [...blockers, ...warnings],
      };
    }

    if (warnings.length > 0) {
      return {
        valid: true,
        message: `⚠️ ${warnings.map(e => `${e.field}: ${e.issue}`).join('; ')}`,
        issues: warnings,
      };
    }

    return { valid: true };
  }

  /** 从 parsed 对象中取值 */
  _getField(parsed, field) {
    if (field.includes('.')) {
      const parts = field.split('.');
      let val = parsed;
      for (const p of parts) {
        if (val == null) return undefined;
        val = val[p];
      }
      return val;
    }
    if (field === 'content') return parsed.content;
    if (field === 'turnType') return parsed.turnType;
    if (field === 'result') return parsed.result;
    if (field === 'collectedFields') return parsed.collectedFields;
    if (field === 'message') return parsed.message;
    return parsed[field];
  }
}
