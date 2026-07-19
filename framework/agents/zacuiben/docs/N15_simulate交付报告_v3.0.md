# 杂碎本 v3.0 N15 Simulate 交付报告

**日期**：2026-07-15
**版本**：v3.0
**状态**：交付就绪 ✅

---

## 一、四件套交付清单

| # | 交付物 | 路径 | 状态 |
|---|--------|------|:---:|
| 1 | L2 母本 | docs/L2_流程文档_v3.0.md | ✅ |
| 2 | L3 包 | l3-package/（9 文件） | ✅ |
| 3 | 骨架代码 | packages/zacuiben/src/（15 模块） | ✅ |
| 4 | Simulate 报告 | docs/N15_simulate交付报告_v3.0.md | ✅ |

---

## 二、管线节点状态

| 节点 | 状态 | 关键产出 |
|:---:|:---:|------|
| P0-N10 | ✅ | L2 流程文档 v3.0，8 根支柱全过，5 intent 可穷举（纯 field_based） |
| N11 | ✅ | 契约对齐 31 项：4❌ 已全部修复，5⚠️ 择机处理 |
| N12 | ✅ | L3 JSON 包 9 文件（1 Schema + 7 宪法 + 1 tunables） |
| N13 | ✅ | 骨架代码 15 模块（state-machine / context-manager / turnType / tunables / constitution-sessions / root-constitution / scheduler / session / dialogue-engine / storage / protector / types / valid-key / state-llm / index） |
| N14 | ✅ | 审骨架 6/6 通过，14 Case 全过，8 机制全过，699 测试全绿 |
| N15 | ✅ | 本报告——参数保持默认值首发，不做 PID 调参 |

---

## 三、测试基线

| 测试文件 | 条数 | 通过 |
|------|:---:|:---:|
| test.js | 151 | ✅ |
| test-v30-turnType-tunables.js | 130 | ✅ |
| test-v30-constitution.js | 186 | ✅ |
| test-v30-context-scheduler.js | 232 | ✅ |
| **合计** | **699** | **✅** |

通过率：**100%（699/699）**

> 注：context-scheduler.js 的 232 条包含 N14 修复阶段追加的 47 条（Case 4：16 + Case 9：18 + Case 10：13），所有新增测试同样 100% 通过。

---

## 四、架构参数（tunable 默认值）

以下参数全部保持 L3 `tunables.json` 中的默认值，未做任何调整：

| 参数 | 默认值 | 取值范围 | 说明 | 消费方 | 需真实数据？ |
|------|:---:|------|------|------|:---:|
| intent_confidence_direct | 80 | [50,100] | 意图直发阈值（≥此值直接分发） | intent-recognition | ❌ |
| intent_confidence_confirm | 60 | [30,80] | 意图确认阈值（≥此值反问确认，<此值引导） | intent-recognition | ✅ |
| content_max_length | 5000 | [500,50000] | 记录内容最大字数 | record-session DET | ❌ |
| attachment_max_count | 5 | [0,20] | 单条记录附件数量上限 | record-session DET | ❌ |
| attachment_image_max_mb | 10 | [1,100] | 图片附件大小上限（MB） | record-session DET | ❌ |
| attachment_video_max_mb | 100 | [10,1000] | 视频附件大小上限（MB） | record-session DET | ❌ |
| attachment_audio_max_mb | 50 | [1,500] | 音频附件大小上限（MB） | record-session DET | ❌ |
| organize_default_days | 7 | [1,90] | 整理时间默认天数 | record-session DET | ✅ |
| organize_skip_auto_discard | 3 | [1,10] | 连续跳过次数≥此值自动废弃 | organize-session DET | ✅ |
| search_timeout_seconds | 10 | [3,60] | 搜索确认超时（秒） | search-session | ❌ |
| turnHistory_limit | 20 | [5,100] | 会话轮次历史保留上限 | context-manager | ❌ |
| pending_fields_ttl | 86400 | [3600,604800] | 偏离时暂存半成品字段保留时长（秒） | session-store | ❌ |

---

## 五、PID 调参状态：未执行

### 5.1 为什么不调

N14 simulate 阶段的 699 条测试全部基于**模拟输入**（单字段、固定短语、极端值、边界值），而非真实用户行为数据。confidence 拦截率、偏离率、冷启动解冻次数等 PID 输入指标在模拟环境下无统计意义：

- **confidence 拦截率**：模拟数据中 LLM 返回的 confidence 为固定或随机值，非真实模型输出
- **偏离率（off-task）**：模拟数据的 bigram Jaccard 偏离检测基于预设短语，非真实对话漂移
- **冷启动窗口**：模拟测试中冷启动窗口设为 1ms 以加速测试，无法反映真实冷启动行为

### 5.2 何时调

| 条件 | 指标 | 触发动作 |
|------|------|---------|
| 真实部署 ≥ 50 会话 | confidence 拦截率统计 | 若 >10%：降低 intent_confidence_confirm；若 <1%：提高 intent_confidence_confirm |
| 真实部署 ≥ 50 整理操作 | organize_skip_auto_discard 触发频率 | 自动废弃频率过高/过低 → 调整阈值 |
| 冷启动观测窗口内 | confidence 拦截率 > cold_start_emergency_threshold | 触发紧急解冻 → 人工确认后调参 |

### 5.3 调参公式（预备）

```
新值 = 旧值 + Kp × (目标值 − 实测值)
```

- **Kp** = 0.1（未启用，首发不设 PID 控制器）
- **仅 intent_confidence_confirm** 参与 PID 自动调节（按 N15 节点说明 §4.1.2）
- **cold_start_observation_window** 为运行时常量，不被 PID 修改

---

## 六、需真实部署后关注的项

| 参数/机制 | 原因 | 数据来源要求 | 回调节点 |
|------|------|------|:---:|
| intent_confidence_confirm | PID 反馈控制需真实 confidence 拦截率 | 冷启动 50 会话后的 confidence 分布 | N16 |
| organize_default_days | 依赖用户整理习惯分布 | 50+ 整理操作后分析 | N16 |
| organize_skip_auto_discard | 依赖真实跳过频率 | 出现自动废弃行为后评估 | N16 |
| 冷启动观测窗口 | 需真实用户行为触发紧急解冻判断 | 拦截率 > 50% 时 | N16 |
| turnHistory 结构补全 | N11 #18 ⚠️：archiveContext 缺少 askingField/changeLevel/changeLevelReason | 合并到日常迭代 | — |
| 接口命名统一 | N11 #20 ⚠️：addTurn/updateGraph 与 archiveContext 不一致 | 合并到日常迭代 | — |

---

## 七、已知局限

1. **PID 调参不可在模拟数据上执行**——N14 的 699 条是模拟输入（单字段、固定短语、极端边界值），非真实用户行为。confidence 拦截率、偏离率、冷启动解冻次数等指标需要真实部署 ≥ 50 会话后才有统计意义。

2. **PWA 前端未更新**——当前骨架代码为主逻辑层（`packages/zacuiben/src/`），`demos/` 下的 PWA 前端仍为 v2.1 旧版，与 v3.0 后端的状态机/宪法体系不匹配。

3. **N11 报告 5 ⚠️ 项未修复**——不影响核心功能，择机处理：
   - #4：expectsChangeLevel 无显式消费点
   - #16：数据携带协议隐式传递（功能等价但缺显式 carry/clear 声明）
   - #17：CLOSING 路径无字段暂存逻辑
   - #18：turnHistory 缺 askingField/changeLevel/changeLevelReason 字段
   - #20：接口命名 addTurn/updateGraph vs archiveContext 不一致

4. **topic_based / topicEvolution 全链路 N/A**——杂碎本纯 field_based，所有环节宪法 `topicEvolutionEnabled=false`。N15 节点说明 §4.1.1 调参信号 #4/#5/#6/#8/#9/#10/#11 全部不适用。

5. **OpenTelemetry 追踪缺失**——N14 机制检查中标注为"轻量验证跳过"，当前骨架代码无 OT span 生成逻辑。

---

## 八、N15→下游传递契约

```json
{
  "tuningPerformed": false,
  "tuningReason": "Simulate 数据不可用于 PID 调参——699 条均为模拟输入，非真实用户行为",
  "parametersAtDefaults": true,
  "totalTests": 699,
  "testPassRate": "100%",
  "skeletonReview": "6/6 通过",
  "testCases": "14/14 通过",
  "mechanismChecks": "8/8 通过",
  "n14Verdict": "pass",
  "deliveryChecklist": {
    "fourDeliverablesComplete": true,
    "versionConsistent": true,
    "l2l3SemanticConsistent": true,
    "l3SkeletonConsistent": true
  },
  "backlogItems": {
    "n11Warnings": 5,
    "pwaOutdated": true,
    "turnHistoryIncomplete": true,
    "otTracingMissing": true
  },
  "nextSteps": "真实部署 ≥ 50 会话 → 收集 confidence 拦截率 / 偏离率 / 冷启动指标 → 执行 PID 调参 → N16 迭代回溯"
}
```

---

## 九、首发建议

| 维度 | 建议 |
|------|------|
| **参数** | 全部保持 L3 `tunables.json` 默认值，不调 |
| **部署** | 先跑 ≥ 50 次真实会话度过冷启动窗口 |
| **监控** | 关注 confidence 拦截率、偏离率、冷启动解冻次数 |
| **回调** | 50 会话后基于真实数据执行 PID 调参（公式见 §5.3） |
| **PWA** | 后续迭代中同步更新 `demos/` 前端至 v3.0 |
| **N11 ⚠️** | 择机修复 turnHistory 字段补全和接口命名统一 |

---

> **报告版本**：v1.0
> **生成日期**：2026-07-15
> **生成方式**：读取 N11/N14 报告 + L2 流程文档 + L3 tunables.json + N15 节点说明 → 运行全量测试（699 条）→ 逐项对照事实生成
> **参数状态**：全部默认值，PID 未启用
