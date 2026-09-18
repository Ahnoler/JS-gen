# B-6 缺陷报告：fill_engine 条件局部 import 遮蔽 → UnboundLocalError（2026-09-18）

> 产线：阶段合约湿测六（对公客户转正，traj #877）；报告人：ZCode 合约湿测线
> 归属：引擎/录制执行链；优先级 **P1**（结构化指引路径崩溃 → agent 试错硬耗，实测单阶段放大 119 步）
> 关联总报告：[2026-09-18-wet-test-defect-handover.md](2026-09-18-wet-test-defect-handover.md) §B-6；证据 `D:\dev\JS-gen-contract\tmp\contract-wet6-20260918\`

## 1. 现象

traj #877 阶段 6（正式客户维护页 FS00004007HostCstmgrCrtCpctInf），agent 对「法定代表人/负责人姓名」等字段执行 `fill_form_field`，字段处于 field-disabled 形态时，结构化提示路径抛 UnboundLocalError，agent 收不到「该字段是下拉/选择控件，请改用对应动作」的指引，改为试错硬耗（click/.send_keys/set_vue_model/run_form_assistant 共 119 步）。executor-main.log 实测（4090/4096/4103 行附近）。

## 2. 根因（file:line，已在 worktree 分支 3c4473ec 代码上核对）

`scripts/controller/actions/fill_engine.py` 同一函数内三个使用点作用域冲突：

- 约 **L220**（tssc-multi-select 分支）与 **L232**（tree-select 分支）：分支内条件性执行 `from .result_protocol import err_with`（tree-select 分支还导 `recommend_action_for_kind`）。
- Python import 语句把 `err_with` 绑定为**函数局部名**——只要函数内任何位置存在局部绑定，整个函数作用域内该名字都按局部名解析。
- 约 **L336+**（field-disabled 路径）调用 `err_with(...)`：该执行路径未经过上述两个分支的 import → 局部名未绑定 → **UnboundLocalError**。

即：命中 tssc/tree-select 分支时正常，命中 field-disabled 分支时崩溃——同函数内「有的路径有 import、有的路径没有」的经典遮蔽缺陷。

## 3. 修法建议

函数顶部（模块级或函数级一次）统一导入：

```python
from .result_protocol import err_with, recommend_action_for_kind
```

删除 L220/L232 两处分支内局部 import。同时自查同函数内其他 `result_protocol` 使用点（set_vue_model 旁路、send_keys 旁路）是否存在同款遮蔽，一并收敛到模块级。

## 4. 验证要求

- 复现：对 field-disabled 字段调用 fill_form_field，修复前 UnboundLocalError、修复后返回 `err-field-disabled` 结构化提示。
- characterization pin：钉 field-disabled 路径返回 err_with 结构（kind=select 等）+ tssc/tree-select 分支行为不回归；入 verify-all。
- 基线：全量 verify-all 已知 3 红零新增（step-highlight/layer-tree/confirm-notification）。
