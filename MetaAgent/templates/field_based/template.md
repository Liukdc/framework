# 环节宪法模板（field_based）

**适用范围**：taskType=field_based 的 IN_SESSION 步骤。字段即边界，每步产出为预定义字段集。

---

<!-- @section constitution -->
field_based
taskType 判定理由：[填写该环节为何归为 field_based——产出为预定义字段集，DET可验]

收敛方向：[填写该环节要完成什么]

<!-- @section role -->
[填写该环节的角色定位和消费上游交付物的顺序]

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
  "changeLevelReason": "一句话判定理由（major/minor时必填。空值/超100字→DET拦截+默认'未提供'+记录警告，触发重试或进入CLARIFYING。用于修改日志记录，非topicEvolution）",
  "message": "",
  "collectedFields": {},
  "result": {}
}
```

<!-- @section completion -->
[填写完成条件]

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
[填写偏离检测规则]

<!-- @section giveup -->
用户说"算了""不做了""先这样吧"→turnType="giveup"

<!-- @section field-rules -->
| 字段 | 校验方法 | 规则 |
|------|---------|------|

<!-- @section parsing -->
[填写字段解析规则]

<!-- @section domain-rule-priority -->
异步规则提炼独立启用——同一 stepName 再次执行时注入已生效领域规则。每份宪法的编写过程记录修改日志（changeLevel/changeLevelReason），供 N10 异步规则提炼消费。

<!-- @section tunable -->
[可选] [填写环节特有tunable参数引用]
