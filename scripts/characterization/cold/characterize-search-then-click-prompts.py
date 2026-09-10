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
    ),
    "scripts/prompts/agent-tools-table.md": (
        "树/列表先查再点",
        "err-search-first",
        "click_table_row_button",
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
        "不要为此增删 phase 条数",
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
