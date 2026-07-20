// @MetaAgent v5.8 — n14-toolchain/run-n14.js
// N14 审骨架主入口：静态检查 → 行为测试 → 机制检查 → 报告

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStaticChecks, formatReport as formatStatic } from './static-checker.js';
import { runSimulate, CASES, formatSimulateReport, saveReport } from './simulate.js';
import { runMechanismChecks, formatMechanismReport } from './mechanism-check.js';

async function main() {
  const outDir = import.meta.dirname || '.';
  console.log('═'.repeat(55));
  console.log('  N14 审骨架 — 元智能体 v5.8');
  console.log('═'.repeat(55));
  console.log('');

  // ═══ 第1关：静态质量检查 ═══
  console.log('【第1关】静态质量检查...');
  const staticResult = runStaticChecks();
  console.log(formatStatic(staticResult));
  console.log('');

  // ═══ 第2关：行为测试 ═══
  console.log(`【第2关】行为测试 (${CASES.length} 个 case)...`);
  let simResult;
  try {
    simResult = await runSimulate();
    console.log(formatSimulateReport(simResult));

    // ═══ 第3关：9+2机制检查 ═══
    console.log('');
    console.log('【第3关】9+2 机制检查...');
    const mechResult = runMechanismChecks(simResult.trace);
    console.log(formatMechanismReport(mechResult));

    // 综合评定
    const totalPassed = staticResult.passed + simResult.passed + mechResult.passed;
    const totalChecks = staticResult.total + simResult.total + mechResult.total;
    console.log('');
    console.log('═'.repeat(55));
    console.log(`  综合评定: ${totalPassed}/${totalChecks} 通过`);
    const verdict = totalPassed === totalChecks ? 'READY' : totalPassed >= totalChecks - 2 ? 'NEEDS_FIX' : 'FAIL';
    console.log(`  Verdict: ${verdict}`);
    console.log('═'.repeat(55));

    // 保存报告
    const report = {
      timestamp: new Date().toISOString(),
      verdict,
      static: staticResult,
      simulate: { passed: simResult.passed, failed: simResult.failed, total: simResult.total },
      mechanisms: { passed: mechResult.passed, failed: mechResult.failed, total: mechResult.total },
    };
    saveReport(report, join(outDir, 'n14-report.json'));
    console.log('\n报告已保存到 n14-report.json');

  } catch (e) {
    console.log(`  ❌ 行为测试异常: ${e.message}`);
    console.log(e.stack);
  }

  console.log('');
}

main().catch(err => {
  console.error('N14 审骨架异常:', err);
  process.exit(1);
});
