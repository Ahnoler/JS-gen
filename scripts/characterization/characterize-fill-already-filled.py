"""Characterization: fill_form_field same-value re-fill guard (2026-09-14).

Born from the 「助手填完 → 主 Agent 终检又填一次」duplicate-step defect: the
form assistant fills by 业务数据/规则 then the main agent re-fills the same
field, writing a second trajectory step (same value → redundant replay
overwrite; different value → silently overwrites the assistant's value and the
replayed final value becomes unstable).

Guard: the record path of fill_form_field must probe the field's current value
and return the non-recordable ``already-filled`` code when it already equals
the target (mirroring click_adjacent_button), while keeping unequal values
fillable (intentional correction must still record).

Pins the guard wiring, its non-recordable result semantics, and the prompt
discipline that stops the agent from blanket re-filling.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILL = (ROOT / "scripts/controller/actions/fill_engine.py").read_text(encoding="utf-8")
PROMPT = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")

failures: list[str] = []


def need(container: str, needle: str, where: str) -> None:
    if needle not in container:
        failures.append(f"MISSING {where} :: {needle!r}")


# ── 守卫本体：probe 现值 + 等值跳过 + 非记录式返回 ──────────────────────────
need(FILL, "# ── 同值重填守卫（录制态）", "fill_engine.py guard marker")
need(FILL, "JS_CHECK_SINGLE_FIELD, [_fill_label, self._button_keywords()]",
     "fill_engine.py value probe")
need(FILL, "_fve(_current, value)", "fill_engine.py equivalence check")
# 函数体后段的 false_ok 回读有一处同名局部 import，使 field_values_equivalent 在整函数
# 作用域退化为局部名——守卫必须先局部绑定别名，否则 UnboundLocalError（AST 未解析名
# 守卫查不出这类「已解析但晚绑定」的坑，只有行为测试能抓）。
need(FILL, "field_values_equivalent as _fve", "fill_engine.py local-alias binding")
need(FILL, "return _ok('already-filled | ' + _current)", "fill_engine.py non-recordable skip")
# 查询态与检索类标签不启用（重填用于重新触发查询，非表单填写语义）
need(FILL, "if not _is_query_mode(self.business_data_store):", "fill_engine.py query-mode exclusion")
need(FILL, "('查询', '搜索', '确定', '提交', '保存')", "fill_engine.py label exclusion")
# 探测异常必须放行（不能因读数失败阻断填写）
need(FILL, "except Exception as _af_exc:", "fill_engine.py probe fail-open")

# ── 跳过码语义：不带 ok 前缀 → 不记录、不算失败 ────────────────────────────
guard_body = FILL.split("# ── 同值重填守卫（录制态）", 1)[1].split("element = await _capture_element", 1)[0]
if "return _ok('ok" in guard_body or "'ok-already-filled" in guard_body:
    failures.append("already-filled must NOT use an ok-prefixed code (would be recorded)")

# ── 提示词纪律：先比对再重填 ──────────────────────────────────────────────
need(PROMPT, "already-filled", "agent-tools-form.md skip cue")
need(PROMPT, "同值重填会写入重复步骤", "agent-tools-form.md duplicate warning")

if failures:
    for f in failures:
        print(f)
    sys.exit(1)

print("characterize-fill-already-filled: OK (same-value re-fill guard pinned)")
