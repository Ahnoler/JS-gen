"""Phase-end stale-pending refresh (ghost-prune pattern at the quality gate).

弹窗/引入回填只记 evidence（introduced_backfilled）不更新 task_list，收尾
pending 门禁纯内存读到的是过期快照，把 DOM 已有值的字段误判 pending_fields
质量失败。这里复用 click_save 已 pin 的 ghost-prune 范式（form_save.py
JS_CHECK_SINGLE_FIELD live-prune）：gate 不过 → JS 实读 DOM → 纠正 task_list
→ 重跑 gate。

守卫语义与 ghost-prune 的差异（有意为之）：ghost-prune 在点击Save现场处理
「disabled 挡写」与「幽灵 pending」（not-found / not-visible / disabled 均可
剪）；收尾语境是「快照过期」而非「按钮被挡」，因此只认一条硬判据 ——
DOM currentValue 非空才算已填（非空即已填）。label-not-found / 不可见 /
JS 异常 / 空值一律不动 task_list，不剪枝不放水，宁可误拒也不假绿。

reason 粘滞纠正：mark_quality_failed 只增不清，premature done 警告在弹窗
刚打开时写入的 pending_fields:* reason 会被收尾沿用。regenerate_pending_field_reasons
按刷新后的 pending 集合重生成 pending_fields:* 条目（标签已移出 → 剔除；
全部移出 → 整条删除并撤下无 reason 支撑的 _quality_failed 标志）；
成功令牌等其余 reason 一律不动（宁误拒不假绿）。
"""

from __future__ import annotations

import json
import sys

from scripts.controller.actions.form_save import JS_CHECK_SINGLE_FIELD
from scripts.controller.actions.form_rules import get_has_button_keywords


async def refresh_pending_from_dom(
    business_data_store: dict | None,
    page,
    section: str = "",
) -> bool:
    """Re-read DOM for gate-pending labels and write back DOM-verified values.

    取当前 pending 标签（filter_pending_labels，section 过滤对齐收尾门禁），
    对每个标签用 JS_CHECK_SINGLE_FIELD 实读 DOM；currentValue 非空者调
    TaskList.mark_done(label, value) 从 pending 移入 done 并写回真实值。
    空值 / label-not-found / 不可见 / JS 异常一律不动。返回是否有纠正。
    """
    if not business_data_store or page is None:
        return False
    from scripts.models.task import TaskList
    from scripts.controller.actions.section_scope import filter_pending_labels

    tl = TaskList.from_store(business_data_store.get("task_list"))
    labels = filter_pending_labels(tl, section)
    if not labels:
        return False
    button_keywords = get_has_button_keywords(business_data_store)
    refreshed: list[str] = []
    for label in labels:
        try:
            raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [label, button_keywords])
            info = json.loads(raw) if isinstance(raw, str) and raw.startswith("{") else {}
        except Exception:
            sys.stderr.write(
                f"[pending-refresh] JS_CHECK_SINGLE_FIELD failed label={label!r}\n"
            )
            sys.stderr.flush()
            continue
        if raw == "label-not-found":
            # 查不到的字段不能证明已填 — 留在 pending，不剪枝。
            continue
        if not isinstance(info, dict) or not info:
            continue
        dom_value = str(info.get("currentValue") or "").strip()
        if not dom_value:
            # 非空即已填 — 空值一律不动。
            continue
        moved = tl.mark_done(label, dom_value)
        if moved is not None:
            refreshed.append(label)
    if refreshed:
        business_data_store["task_list"] = tl.to_store()
        sys.stderr.write(
            f"[pending-refresh] backfilled fields verified in DOM, marked done: {refreshed}\n"
        )
        sys.stderr.flush()
    return bool(refreshed)


def regenerate_pending_field_reasons(
    business_data_store: dict | None,
    pending_labels: list[str] | None,
) -> None:
    """Rewrite sticky ``pending_fields:*`` reasons against the refreshed pending set.

    标签已移出 pending → 从 reason 中剔除；全部移出 → 整条删除。其余 reason
    （成功令牌缺失 / semantic_doubt_fields / cycle_deviate …）原样保留。
    收尾在 QUALITY FAIL 输出之前调用（传入收尾门禁最后一次跑出的 pending 集合）。
    """
    if not business_data_store:
        return
    reasons = business_data_store.get("_quality_failed_reasons")
    if not isinstance(reasons, list):
        return
    alive = {str(x) for x in (pending_labels or [])}
    regenerated: list[str] = []
    for r in reasons:
        if not (isinstance(r, str) and r.startswith("pending_fields:")):
            regenerated.append(r)
            continue
        kept = [x.strip() for x in r[len("pending_fields:"):].split(",") if x.strip()]
        kept = [x for x in kept if x in alive]
        if kept:
            regenerated.append("pending_fields:" + ",".join(kept))
        # 全部移出 → 整条删除（不落空条目）
    business_data_store["_quality_failed_reasons"] = regenerated
    if not regenerated:
        # 每次 mark_quality_failed 都至少追加一条 reason；重生成后 reason 清空
        # 说明已无任何支撑，撤下失败标志（成功令牌 reason 未清时不会走到这）。
        business_data_store["_quality_failed"] = False
