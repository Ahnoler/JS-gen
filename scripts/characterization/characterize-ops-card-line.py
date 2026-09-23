import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.agent.stderr_cards import format_card_line, format_phase_header_line

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

text = "摘要" * 100 + "\n第二行"
line = format_card_line("kb", 1, "对公用信申请", text, score=100)
assert_true("\n" not in line, line)
payload = json.loads(line.split("[card] ", 1)[1])
assert_true(payload["text"] == text and payload["score"] == 100, payload)

header = format_phase_header_line(3, "第一行\n第二行" * 20, 300)
assert_true(header.startswith("Phase 3: ") and header.endswith(" (max_steps=300)"), header)
assert_true("\n" not in header and "\\n" in header, header)
assert_true("task_text[:80]" not in Path(ROOT / "scripts/agent/service.py").read_text(encoding="utf-8"),
            "phase header still slices at 80")

print("characterize-ops-card-line: OK")
