#!/usr/bin/env python3
"""Characterization pin: click_save notification classification regexes.

Source of truth: scripts/controller/actions/js_snippets/save.py — TWO pairs of
successRe / failRe (post-save scan JS_SCAN_SAVE_OUTCOME and in-flight watch
JS_WATCH_SAVE_NOTIFICATIONS). Both pairs must stay in sync.

Background (2026-09-18 phase-contract wet-test, traj #867/#868 circuit breaker):
  The SUT shows "客户校验成功" when a save succeeds. The old failRe contained a
  bare 校验 alternative, so the success toast was classified into errorNotifs;
  form_save.py click_save then returned err-save-notification ("Do NOT treat as
  success") BEFORE the URL-change detection branch — url_change evidence was
  never recorded and the phase contract (toast_ok/url_change/saved_navigation)
  became unsatisfiable, tripping the 3-rejection circuit breaker.

Fix pinned here (save.py only):
  - successRe gains |校验成功  (both occurrences)
  - failRe drops bare |校验    (both occurrences; 校验失败 covered by 失败,
    校验不通过 covered by 不通过 — semantics preserved)

Known text/mechanism map (do not "fix" by widening failRe):
  - 「保存失败」/「证件号码格式校验不通过」/「客户名称不能为空」: keyword hits
    on the (new) failRe — pinned as still-error.
  - 「该客户已发起评级流程，请等待流程完成后再进行评级」: server business-error
    toast with NO failRe keyword (true under the old regex too) — classified
    error via the error-className branch of collect(); pinned through the full
    classify() mirror, NOT through failRe.
  - 「请输入客户名称」: el-form-item validation error — collected into
    formErrors by the .el-form-item__error loop, before any toast regex.

Run:
  D:/anaconda3/python.exe scripts/characterization/characterize-save-notification-classify.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SAVE_PY = ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "save.py"

# Post-fix failRe, replicated for behavior assertions (mirrors the JS source).
NEW_FAIL_RE = r"失败|错误|异常|不能|不允许|已存在|重复|必填|不通过"
# Post-fix successRe (suffix; the pin extracts the full pattern from source).
NEW_SUCC_TAIL = "克隆成功|校验成功"
ERROR_CLASS_RE = r"el-notification--error|el-message--error|el-message--warning"

# Texts and their expected classification after the fix.
MUST_FAIL = [
    "保存失败",
    "证件号码格式校验不通过",
    "客户名称不能为空",
]
MUST_NOT_FAIL = [
    "客户校验成功",  # SUT save-success toast — the false-positive being fixed.
]
MUST_SUCCEED = [
    "客户校验成功",
    "操作成功",
    "保存成功",
]
MUST_NOT_SUCCEED = [
    "保存失败",
    "该客户已发起评级流程，请等待流程完成后再进行评级",
    "请输入客户名称",
]
# Error via className, not keyword (no failRe alternative matches this text).
CLASSNAME_ERROR_TEXT = "该客户已发起评级流程，请等待流程完成后再进行评级"


def extract_all(source: str, name: str) -> list:
    """Extract every `const <name> = /.../;` regex body from save.py source."""
    return re.findall(r"const " + name + r" = /(.+?)/;", source)


def classify(text: str, class_name: str = "", fail_re: str = NEW_FAIL_RE) -> str:
    """Python mirror of JS_SCAN_SAVE_OUTCOME collect(): fail-first, else success."""
    if re.search(fail_re, text) or re.search(ERROR_CLASS_RE, class_name or ""):
        return "error"
    return "success"


def main() -> int:
    src = SAVE_PY.read_text(encoding="utf-8")
    failures = []

    def check(ok: bool, name: str, detail: str = "") -> None:
        if not ok:
            failures.append(f"{name} — {detail}")
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if not ok else ""))

    # ── 0. Exactly 2 identical pairs (scan + watch stay in sync) ────────────
    success_patterns = extract_all(src, "successRe")
    fail_patterns = extract_all(src, "failRe")
    check_pair = (
        len(success_patterns) == 2
        and len(fail_patterns) == 2
        and len(set(success_patterns)) == 1
        and len(set(fail_patterns)) == 1
    )
    check_pair_msg = (
        f"expected exactly 2 identical successRe and 2 identical failRe, "
        f"got successRe={len(success_patterns)} failRe={len(fail_patterns)}"
    )
    check(check_pair, "0. exactly 2 identical successRe/failRe pairs", check_pair_msg)

    # ── 1. failRe must not contain bare 校验 (both occurrences) ─────────────
    ok = check_pair and all("校验" not in p for p in fail_patterns)
    check(ok, "1. failRe (both occurrences) contains no bare 校验", f"failRe={fail_patterns[0]!r}")

    # ── 2. successRe must contain 校验成功 (both occurrences) ───────────────
    ok = check_pair and all("校验成功" in p for p in success_patterns)
    check(ok, "2. successRe (both occurrences) contains 校验成功", f"successRe={success_patterns[0]!r}")

    # ── 3. Behavior: Python re replica of the (new) regexes ─────────────────
    if check_pair:
        succ_bodies = set(success_patterns)
        for p in fail_patterns:
            for t in MUST_FAIL:
                check(bool(re.search(p, t)), f"3a. failRe hits {t!r}")
            for t in MUST_NOT_FAIL:
                check(not re.search(p, t), f"3b. failRe does NOT hit {t!r}")
            # className-driven error path stays intact (text has no keyword).
            check(
                classify(CLASSNAME_ERROR_TEXT, "el-message el-message--error", p) == "error",
                "3c. error-className toast still classified error (评级流程 server error)",
            )
        for p in succ_bodies:
            for t in MUST_SUCCEED:
                check(bool(re.search(p, t)), f"3d. successRe hits {t!r}")
            for t in MUST_NOT_SUCCEED:
                check(not re.search(p, t), f"3e. successRe does NOT hit {t!r}")
    else:
        check(False, "3. behavior assertions skipped", check_pair_msg)

    # ── 4. formErrors collection marker (「请输入客户名称」-class input errors
    #      are captured by the .el-form-item__error loop, independent of regex) ─
    check(".el-form-item__error" in src, "4. form-item error loop present in save.py")

    if failures:
        print(f"\ncharacterize-save-notification-classify: {len(failures)} FAILURE(S)")
        return 1
    print("\ncharacterize-save-notification-classify: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
