"""Agent result protocol (2026-08-27 spec) — 三段式 err 结果与 use 推荐.

Spec: docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md
Shape: 'err-<code> | 原因:<reason> | 现场:<observed> | 下一步:<next_action>'
空段整段省略；code 必须连字符小写（duplicate_failure_cue.step_failed 的
startswith('err-') 硬约束）。现场/下一步由调用点当场采集后传入，本模块不编造。
"""
from __future__ import annotations

import re

from ._helpers import _err, _ok

_CODE_RE = re.compile(r"^err-[a-z0-9-]+$")

# kind -> 推荐动作（防呆前置单点出处；spec §第3层映射表）
_KIND_ACTIONS = {
    "select": 'select_option(label_text="<此字段label>", option_text=<选项原文>)',
    "date": "fill_form_field(值需 YYYY-MM-DD)",
    "tree-select": 'select_tree_option(label_text="<此字段label>", option_text=<选项原文>)',
    "radio": "click_radio",
}


def recommend_action_for_kind(kind: str) -> str:
    k = (kind or "").strip()
    if k in _KIND_ACTIONS:
        return _KIND_ACTIONS[k]
    return "fill_form_field(label_text=\"<此字段label>\", value=<文本值>)"


def _sections(reason: str, observed: str, next_action: str) -> str:
    esc = lambda s: s.replace("|", "｜")
    out = ""
    if reason:
        out += f" | 原因:{esc(reason)}"
    if observed:
        out += f" | 现场:{esc(observed)}"
    if next_action:
        out += f" | 下一步:{esc(next_action)}"
    return out


def err_with(code: str, reason: str, observed: str = "", next_action: str = "",
             include_in_memory: bool = False):
    """Build the three-section protocol ActionResult (_err wrapped).

    Sections always ordered 原因→现场→下一步; empty section omitted entirely.
    error attr mirrors 'err-<code>' so duplicate_failure_cue matches.
    ``code`` may be given bare (``select-option-unresolved``) or already
    prefixed (``err-select-option-unresolved``); the emitted text always
    starts with ``err-`` and matches ``err-[a-z0-9-]+``.
    ``include_in_memory`` is forwarded to ``_err`` so long-context recording
    retains high-signal failure guidance (e.g. save-button-not-found).
    """
    c = (code or "").strip().lower()
    bare = c[4:] if c.startswith("err-") else c
    if not bare or not re.fullmatch(r"[a-z0-9-]+", bare):
        raise ValueError(f"protocol code must match err-[a-z0-9-]+, got {code!r}")
    if not reason:
        reason = "未提供"
    text = f"err-{bare}{_sections(reason or '', (observed or '').strip(), (next_action or '').strip())}"
    res = _err(text, include_in_memory=include_in_memory)
    # Mirror the protocol code on ActionResult.error so duplicate_failure_cue
    # (which keys off startswith('err-')) and characterization pins can read it.
    res.error = f"err-{bare}"
    return res


def validate_protocol(text: str) -> list[str]:
    """Return violations ([] == valid). Used by characterization pins.

    Detects: missing 原因 segment (缺段), wrong section order (乱序),
    duplicate segment (重复), bad prefix, bad code charset (码字符集).
    """
    t = (text or "").strip()
    bad: list[str] = []
    if not t.startswith("err-"):
        bad.append("prefix: must start with err-")
    head = t.split(" ", 1)[0].rstrip(":")
    if t.startswith("err-") and not _CODE_RE.match(head):
        bad.append(f"code charset: {head!r}")
    # 原因: is the mandatory first body segment — its absence is a 缺段 violation.
    if "原因:" not in t:
        bad.append("missing segment 原因:")
    for seg in ("原因:", "现场:", "下一步:"):
        idx = t.find(seg)
        if idx >= 0 and t.find(seg, idx + 1) > idx:
            bad.append(f"duplicate segment {seg}")
    order = [t.find(s) for s in ("原因:", "现场:", "下一步:") if t.find(s) >= 0]
    if order != sorted(order):
        bad.append("section order must be 原因→现场→下一步")
    return bad


def ok_marked(store=None, label: str = "", got: str = "", *, fallback: str = "",
              wanted: str = ""):
    """Honest success. fallback non-empty => mark semantic doubt into store
    ('_semantic_doubts' label list, dedup) so phase-end can surface it."""
    parts = [got or label]
    fb = (fallback or "").strip()
    if fb:
        parts.append(fb)
    if fb and (wanted or "").strip() and (wanted or "").strip() != got:
        parts.append(f"wanted:{wanted}")
    try:
        if store is not None and fb and label:
            lst = store.setdefault("_semantic_doubts", [])
            if label not in lst:
                lst.append(label)
                if len(lst) > 64:
                    del lst[:-64]
    except Exception:
        pass
    return _ok(" | ".join(p for p in parts if p))


_AFFORDANCES_JS = r"""(labelText) => {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    let scopeLabel = '';
    let fi = null;
    const items = [...document.querySelectorAll('.el-form-item')];
    if (labelText) {
        for (const it of items) {
            const lab = it.querySelector('.el-form-item__label');
            const t = lab ? norm(lab.textContent) : '';
            if (!t) continue;
            if (t === labelText || t.includes(labelText)) { fi = it; break; }
        }
    }
    const root = fi || document;
    if (fi) scopeLabel = norm((fi.querySelector('.el-form-item__label') || {}).textContent);
    const vis = (el) => el && el.offsetParent !== null;
    const kind = fi
        ? (fi.querySelector('.el-select') ? 'select'
           : fi.querySelector('.el-date-editor, .tsscdatepicker') ? 'date'
           : fi.querySelector('.el-cascader') ? 'cascader'
           : fi.querySelector('[class*="tssc"]') && (fi.querySelector('.tree-popover, .my-popover')) ? 'tree'
           : fi.querySelector('textarea') ? 'input' : 'input')
        : 'unknown';
    let options = [];
    if (!fi || kind === 'select') {
        const dds = [...document.querySelectorAll('.el-select-dropdown')]
            .filter(d => d.getBoundingClientRect().width > 0);
        const dd = dds[dds.length - 1];
        if (dd) {
            options = [...dd.querySelectorAll('.el-select-dropdown__item')]
                .map(o => norm(o.textContent)).filter(Boolean).slice(0, 30);
        }
    }
    const buttons = [...root.querySelectorAll('button, .el-button, a')]
        .filter(b => vis(b) && !b.closest('.el-table__body-wrapper'))
        .map(b => ({ text: norm(b.innerText || b.textContent).slice(0, 40),
                     tag: b.tagName.toLowerCase() }))
        .filter(x => x.text)
        .slice(0, 8);
    return {
        kind,
        options: options.slice(0, 10),
        buttons,
        radio: !!root.querySelector('.el-radio, input[type=radio]'),
        in_overlay: !!(fi && fi.closest('.el-dialog, .el-drawer, .el-message-box')),
    };
}"""


async def affordances(page, label_text: str | None = None) -> dict:
    """One-pass DOM affordance snapshot (原因/现场 的素材来源). 失败安全：异常返 {}."""
    try:
        raw = await page.evaluate(_AFFORDANCES_JS, label_text)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}
