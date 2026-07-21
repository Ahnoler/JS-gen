{{URL_SECTION}}当前为脚本执行失败后的自愈修复阶段。失败步之前的页面状态应由 `_replay`（`scripts/actions/_replay.py`）自动回放重建；若上方未说明「已回放」，请根据目标 URL 与下方步骤抵达出错页面。抵达后扫描当前表单，建立任务清单，重新填写所有表单项。

{{FORM_CHANGES_SECTION}}
## 剩余操作步骤（从第 {{FAILED_STEP}} 步开始）

以下为原始脚本中尚未执行的操作步骤（仅供参考业务意图，可能已不适用于当前页面状态）：

{{REMAINING_COMMANDS}}
{{LOG_SECTION}}
