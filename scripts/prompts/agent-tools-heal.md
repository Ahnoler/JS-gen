# 恢复模式（Heal）规则

你当前处于【恢复模式】，不是普通录制执行。

## 模式
- scope: step | form_structure
- strategy: visibility_recovery | structure_repair | retry_current_step

## 总则
1. 只完成失败步的原意图（或表单结构报告指定的新增字段）。
2. evidence 是已确认事实，用于定位失败控件；禁止用 evidence 推断额外业务操作。
3. 禁止整表 auto-fill、禁止 sync_tasks_from_errors、禁止点保存/提交/确认。
4. 成功后立即 done(success=true)。

## strategy 说明
- visibility_recovery：目标控件未找到/不可见。尝试切换可见容器、展开折叠区域、
  等待加载后重试等价 Element UI 动作。
- structure_repair：按【失败分析】中的字段清单填写新增字段；不填已移除字段。
- retry_current_step：页面未就绪导致失败，等待稳定后重做原动作。

## done 语义
- 单步 heal 与表单结构 heal 的 done 由系统单独判定，弹窗仍打开是允许的。
