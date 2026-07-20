// @MetaAgent v5.8 — constitutions/loader.js
// 宪法加载器：从 L3 索引加载 16 份环节宪法（每人独立，环节隔离）
// v5.8 P0修复: 消除合并加载(N2-N6/N7-N10/N11-N15分组)造成的环节隔离违反

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 加载环节宪法索引 */
export function loadConstitutionIndex(l3Path) {
  const indexPath = join(l3Path, 'constitutions', 'index.json');
  if (!existsSync(indexPath)) {
    console.warn(`[constitution-loader] 宪法索引不存在: ${indexPath}，返回空宪法`);
    return { constitutionFiles: {}, loadPaths: [], constitutionCount: 0 };
  }
  const raw = readFileSync(indexPath, 'utf-8');
  return JSON.parse(raw);
}

/** 加载所有环节宪法原始文本（16 份独立加载） */
export function loadAllConstitutions(l3Path) {
  const index = loadConstitutionIndex(l3Path);
  const result = {};
  // loadPaths 是相对 l3Path 的路径，解析为绝对路径
  const rawPaths = index.loadPaths || ['..'];
  const resolvedPaths = rawPaths.map(p => join(l3Path, p));

  for (const [intent, filename] of Object.entries(index.constitutionFiles)) {
    let text = _findAndRead(resolvedPaths, filename);

    // N2 特殊：加载角色二宪法
    if (intent === 'N2' && index.n2Role2Constitution) {
      const role2Text = _findAndRead(resolvedPaths, index.n2Role2Constitution);
      text = (text || '') + (role2Text ? '\n\n---\n\n' + role2Text : '');
    }

    if (text) {
      result[intent] = text;
    } else {
      console.warn(`[constitution-loader] 未找到宪法: ${intent} → ${filename} (搜索路径: ${resolvedPaths.join(', ')})`);
      result[intent] = '';
    }
  }

  return { index, texts: result };
}

/** 从候选路径列表中搜索并读取文件 */
function _findAndRead(loadPaths, filename) {
  for (const base of loadPaths) {
    const fullPath = join(base, filename);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, 'utf-8');
    }
  }
  return null;
}

/** 按 intent 获取对应宪法文本（1:1 直接映射） */
export function getConstitutionForIntent(intent, constitutions) {
  const { texts } = constitutions;
  return texts[intent] || '';
}
