import json
import sys

def format_card_line(kind, phase, title, text, score=None):
    payload = {"kind": kind, "phase": int(phase), "title": title, "text": text if text is not None else ""}
    if score is not None:
        payload["score"] = score
    return "[card] " + json.dumps(payload, ensure_ascii=False)

def format_phase_header_line(step_index, task_text, max_steps):
    flat = str(task_text or "").replace("\r\n", "\n").replace("\n", "\\n")
    return f"Phase {step_index}: {flat} (max_steps={max_steps})"

def emit_card(kind, phase, title, text, score=None):
    if not str(text or "").strip():
        return
    sys.stderr.write(format_card_line(kind, phase, title, text, score=score) + "\n")
    sys.stderr.flush()
