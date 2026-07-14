# 环节宪法模板（topic_based）

**适用范围**：taskType=topic_based 的 IN_SESSION 步骤。话题边界模糊，需语义理解，启用 topicEvolution。

---

<!-- @section constitution -->
topic_based
taskType 判定理由：[填写该环节为何归为 topic_based——存在语义模糊空间，无唯一正确答案，需多轮渐进收敛]

收敛方向：[填写该环节要完成什么，确保五层注入规则完整]

<!-- @section role -->
[填写该环节的角色定位和消费上游交付物的顺序]

<!-- @section topic-boundary -->
[填写话题边界——✅允许讨论的范围，❌不允许讨论的范围]

<!-- @section convergence -->
[填写该环节的产出物清单]

<!-- @section ask-rules -->
[填写分阶段引导规则，每阶段含 askingField]

**用户确认标准**：显式确认 / 隐式确认 / 沉默跳过

<!-- @section output-schema -->
```json
{
  "turnType": "complete | reply | ask | off-task | giveup | validation_failed",
  "askingField": "[填写]",
  "changeLevel": "major | minor | invalid",
  "changeLevelReason": "一句话判定理由（major/minor时必填。空值/超100字→DET拦截+默认'未提供'+记录警告，触发重试或进入CLARIFYING。用于topicEvolution分层留存）",
  "topicId": "父级N5管理——格式 {userId}_{intent}_{topicSlug}_{date}",
  "message": "",
  "collectedFields": {},
  "result": {}
}
```

<!-- @section completion -->
[填写完成条件——含topicId声明要求]

**静默自检**（不输出给用户）：
A) required字段无遗漏
B) enum值有效
C) 条件必填字段满足
D) 数量关系和逻辑一致性
E) 引用一致性校验

<!-- @section validation -->
```json
{
  "required_fields": [],
  "rules": []
}
```

<!-- @section modification -->
[填写修改规则]

<!-- @section off-task-detection -->
[填写偏离检测规则——含N2双角色故障和topic_based特有偏离处理]

<!-- @section giveup -->
用户说"算了""不做了""先这样吧"→turnType="giveup"

---

**topicId 说明**（父级 N5 管理）：
本环节的 topicId 由 N5 的 ANALYZING 阶段生成并存入 contractStore.topicEvolution。设计过程的 changeLevel event 由调度器追加到 topicEvolution 记录中。本声明满足 N12 拆包校验要求。

**changeLevel 判定规则**：
- invalid：本轮完全撤销上一轮实质性变更，无新有效信息
- major：核心设计决策的根本转向
- minor：其余一切。若模型未返回或格式错误→调度器默认标记为 minor

**三层注入说明**（N5 第2层 topicBased 锚点模式）：
- 第0层：领域规则注入——按 topicPath 子图匹配精准注入
- 第1层：关联主题摘要卡片
- 第2层：topicEvolution 分层包——majorEvents+compressedMinorSummary+recentMinorEvents+currentStateSnapshot
