// @MetaAgent v5.8 — constitutions/loader.js
// 宪法加载器：从 L3 配置文件加载 16 份环节宪法

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 加载环节宪法索引 */
export function loadConstitutionIndex(l3Path) {
  const raw = readFileSync(join(l3Path, 'constitutions', 'index.json'), 'utf-8');
  return JSON.parse(raw);
}

/** 加载所有环节宪法原始文本 */
export function loadAllConstitutions(l3Path) {
  const index = loadConstitutionIndex(l3Path);
  const result = {};
  // 宪法文件的 loadPath 指向 态控架构/节点说明/，但实际宪法在 MetaAgent/docs/
  // 尝试两个路径
  const candidates = [
    join(l3Path, '..'),                          // MetaAgent/docs/
    join(l3Path, '..', '..', '态控架构', '节点说明'), // 态控架构/节点说明/
  ];

  for (const [key, filename] of Object.entries(index.constitutionFiles)) {
    let loaded = false;
    for (const base of candidates) {
      const fullPath = join(base, filename);
      if (existsSync(fullPath)) {
        result[key] = readFileSync(fullPath, 'utf-8');
        loaded = true;
        break;
      }
    }
    if (!loaded) {
      console.warn(`[constitution-loader] 未找到宪法文件: ${filename}`);
      result[key] = '';
    }
  }
  return { index, texts: result };
}

/** 按 intent 获取对应宪法文本 */
export function getConstitutionForIntent(intent, constitutions) {
  const { index, texts } = constitutions;
  if (intent === 'P0') return texts['P0'] || '';
  if (intent === 'N1') return texts['N1'] || '';
  if (['N2', 'N3', 'N4', 'N5', 'N6'].includes(intent)) return texts['N2-N6'] || '';
  if (['N7', 'N8', 'N9', 'N10'].includes(intent)) return texts['N7-N10'] || '';
  if (['N11', 'N12', 'N13', 'N14', 'N15'].includes(intent)) return texts['N11-N15'] || '';
  return '';
}
