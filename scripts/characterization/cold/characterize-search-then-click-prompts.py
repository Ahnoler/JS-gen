"""Pin search-then-click prompt + analyze enrichment needles."""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

NEEDLES: dict[str, tuple[str, ...]] = {
    "scripts/prompts/agent-core.md": (
        "树/列表先查再点",
        "err-search-first",
        'click_table_row_radio(row_text="first")',
        'option_text="first"',
    ),
    "scripts/prompts/agent-tools-tree.md": (
        "STC 后选首叶",
        'option_text="first"',
        "勿传业务节点名",
    ),
    "scripts/prompts/agent-tools-table.md": (
        "树/列表先查再点",
        "err-search-first",
        "click_table_row_button",
        'click_table_row_radio(row_text="first")',
        "勿传客户编号/名称",
    ),
    "scripts/prompts/agent-tools-common.md": (
        "树/列表先查再点",
        "err-search-first",
        "expand_all_el_tree",
    ),
    "scripts/prompts/phase-reviewer-prompt.md": (
        "先搜索",
        "brief_plan",
    ),
    "src/services/trajectory/trajectory-meta-service.js": (
        "先搜索/查询再点击",
        # 数量纪律：补写「先搜索/查询再点击」不得改变 phase 条数。
        # 原 needle「不要为此增删 phase 条数」随 78c89d77 的提示词重写被删，
        # 该纪律改由规则 9「阶段数量原则：能少则少…不要为了凑数量而拆分本应
        # 合并的操作」承接（措辞变、意图在）——故按现行文案更新 needle。
        "不要为了凑数量而拆分",
        # #676: must not strip user-named targets into vague「关键字」
        "必须原样保留",
        "禁止把具体名抹成",
    ),
}


def main() -> int:
    for rel, needles in NEEDLES.items():
        path = ROOT / rel
        if not path.is_file():
            print(f"FAIL: missing {rel}")
            return 1
        text = path.read_text(encoding="utf-8")
        for needle in needles:
            if needle not in text:
                print(f"FAIL: {rel} missing needle {needle!r}")
                return 1
    print("OK search-then-click-prompts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
