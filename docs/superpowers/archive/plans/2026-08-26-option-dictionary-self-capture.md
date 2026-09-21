# 下拉选项码值字典自采集 Plan

> 关联 spec：2026-08-26-option-dictionary-self-capture.md
> 状态：**挂起**（不执行；恢复时按本计划推进）

## 步骤（恢复执行时）

### P1 采集能力（Python 录制/扫描链路）
- scan_form.py / select_option 流：新增 openOptionDict(prop)：点击展开 → 轮询选项稳定 → 读 li.__vue__.$props 收集 {value,label,disabled} → 关闭（Esc）
- 数据归一化：{prop: {value: label}}，存表单上下文 + 输出到会话字典文件

### P2 回填使用
- validate-backfill / 填写工具：报文码值 → 字段字典 → label 匹配点击；缺失 → label 模糊兜底 + 标注
- 输出报告增加 码值转换命中率

### P3 验证与门禁
- characterization：字典采集（假 DOM 注入 `li.__vue__`）与码值→label 匹配纯函数 pin
- verify-all.sh ALL GREEN；lint 0 error

### P4 提交
- scripts-only 变更（免 CHANGELOG）；若触 src/ 补 CHANGELOG
