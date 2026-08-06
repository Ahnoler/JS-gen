{{URL_SECTION}}当前为脚本执行失败后的自愈修复阶段。失败步之前的页面状态应由 `_replay`（`scripts/actions/_replay.py`）自动回放重建；若上方未说明「已回放」，请根据目标 URL 与下方步骤抵达出错页面。抵达后若合约 `allow_form_assistant=true` 则调用 `run_form_assistant()` 批量填表，否则逐字段 fill/select；`scan_form_fields` 仅建任务列表、不再自动填表。若任务中附带【特殊元素库候选】，可对列出的 id 调用 `use_special_element` 复用已入库的复杂组件操作组。

{{FORM_CHANGES_SECTION}}
## 剩余操作步骤（从第 {{FAILED_STEP}} 步开始）

以下为原始脚本中尚未执行的操作步骤（仅供参考业务意图，可能已不适用于当前页面状态）：

{{REMAINING_COMMANDS}}
{{LOG_SECTION}}
