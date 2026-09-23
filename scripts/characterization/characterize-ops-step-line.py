import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.recorder import format_step_stderr_line

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

goal = ("目标" * 120) + "\n含 | act= 分隔"
line = format_step_stderr_line(4, True, False, goal, '{"done":{}}', "结果" * 80, "")
assert_true("\n" not in line, line)
assert_true(line.startswith("[step 4] done=yes stopped=no | goal="), line)
rest = line.split(" | goal=", 1)[1]
_dec = json.JSONDecoder()
_pos = 0
g, _pos = _dec.raw_decode(rest, _pos)
assert_true(rest[_pos:_pos + 7] == " | act=", rest[_pos:_pos + 20])
_pos += 7
a, _pos = _dec.raw_decode(rest, _pos)
assert_true(rest[_pos:_pos + 7] == " | res=", rest[_pos:_pos + 20])
_pos += 7
r, _pos = _dec.raw_decode(rest, _pos)
assert_true(rest[_pos:_pos + 7] == " | err=", rest[_pos:_pos + 20])
_pos += 7
e, _pos = _dec.raw_decode(rest, _pos)
assert_true(g == goal, g)
assert_true(a == '{"done":{}}', a)
assert_true(r == "结果" * 80, r)
assert_true(e == "", e)

src = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
step_fn = src.split("def format_step_stderr_line", 1)[1].split("\ndef ", 1)[0]
assert_true("[:200]" not in step_fn and "[:500]" not in step_fn, "step formatter still slices")
assert_true("max_chars=120" not in src, "compact 120 cap still present")
action_log = src.split("log_line =", 1)[1].split("_ACTION_LOG.append", 1)[0]
assert_true("[:120]" in action_log and "[:400]" in action_log, "ACTION_LOG slices must stay")

print("characterize-ops-step-line: OK")
