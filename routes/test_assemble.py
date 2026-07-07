"""
Script assembly pipeline — replaces src/routes/test-assemble.js
"""
import json
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.script_assembler import assemble_script, _SKIP_ACTIONS
from scripts.models import ActionEntry

router = APIRouter()

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
GENERATED_DIR = SCRIPTS_DIR / "generated"
ACTIONS_DIR = SCRIPTS_DIR / "action"


def _dedup_actions(entries):
    """Consecutive-only dedup (same action+params back-to-back)."""
    result = []
    for i, entry in enumerate(entries):
        if i > 0:
            prev = result[-1]
            if prev.get("action") == entry.get("action") and prev.get("params") == entry.get("params"):
                continue
        result.append(entry)
    return result


def _get_ctrl_injection():
    """Equivalent of getInjectionCode() from ctrl-actions.js."""
    ctrl_path = Path(__file__).resolve().parent.parent / "src" / "ctrl-actions.js"
    try:
        content = ctrl_path.read_text(encoding="utf-8")
        # Extract the CTRL_OBJECT template literal
        m = re.search(r'const CTRL_OBJECT = `(\{[\s\S]*?\})`;', content)
        if m:
            ctrl_obj = m.group(1)
            indent = "  "
            lines = ctrl_obj.strip().split("\n")
            indented = "\n".join(indent + "  " + line for line in lines)
            return f'{indent}// Inject Element UI helpers\n{indent}await page.evaluate(() => {{\n{indent}  window.CTRL = {indented}\n{indent}}});'
    except Exception:
        pass
    return "// CTRL helpers not loaded"


@router.get("/api/test/generated")
async def list_generated():
    items = []
    if GENERATED_DIR.exists():
        index_path = GENERATED_DIR / "index.json"
        if index_path.exists():
            items = json.loads(index_path.read_text(encoding="utf-8"))
    return {"items": items}


@router.post("/api/test/assemble")
async def assemble(request: Request):
    body = await request.json()
    action_file = body.get("actionFile", "")
    preview = body.get("preview", False)

    if not action_file:
        return JSONResponse({"error": "actionFile is required"}, status_code=400)

    abs_path = Path(SCRIPTS_DIR.parent / action_file)
    if not abs_path.exists():
        return JSONResponse({"error": f"actionFile not found: {abs_path}"}, status_code=404)

    # Read and deduplicate
    raw = json.loads(abs_path.read_text(encoding="utf-8"))
    entries = raw.get("actions", raw.get("tests", [{}])[0].get("commands", []))
    deduped = _dedup_actions(entries)
    url = raw.get("url", "") or ""

    # Normalize to ActionEntry
    actions = [ActionEntry(**a) if isinstance(a, dict) else a for a in deduped]

    ts = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S-%fZ")[:-3] + "Z"
    clean_path = GENERATED_DIR / f"cleaned_{ts}.json"
    script_path = GENERATED_DIR / f"script_{ts}.js"

    if preview:
        clean_path = Path(tempfile.gettempdir()) / f"cleaned_preview_{ts}.json"
        script_path = Path(tempfile.gettempdir()) / f"script_preview_{ts}.js"
    else:
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        clean_path.write_text(json.dumps({"actions": deduped, "url": url}, ensure_ascii=False, indent=2), encoding="utf-8")

    # Look for matching form snapshot
    m = re.match(r'^action_(\d{8}_\d{6})\.json$', Path(action_file).name)
    form_snapshots = None
    if m:
        form_path = SCRIPTS_DIR / "forms" / f"form_{m.group(1)}.json"
        if form_path.exists():
            form_snapshots = json.loads(form_path.read_text(encoding="utf-8"))

    # Write CTRL injection (for the assembler to read)
    ctrl_injection_path = Path(tempfile.gettempdir()) / f"ctrl_injection_{ts}.js"
    ctrl_injection_path.write_text(_get_ctrl_injection(), encoding="utf-8")

    # Directly call assembler (no subprocess!)
    import scripts.script_assembler as sa
    sa._ctrl_injection_path = str(ctrl_injection_path)
    script = assemble_script(actions, url, form_snapshots=form_snapshots)

    script_path.write_text(script, encoding="utf-8")

    # Register in index
    test_id = ""
    file_name = ""
    if not preview:
        index_path = GENERATED_DIR / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
        test_id = f"assembled_{ts}"
        file_name = f"script_{ts}.js"
        index.insert(0, {"testId": test_id, "fileName": file_name, "createdAt": datetime.utcnow().isoformat()})
        index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    visible = [a for a in actions if a.action not in _SKIP_ACTIONS]

    return {
        "script": script,
        "testId": test_id,
        "fileName": file_name,
        "steps": len(visible),
        "meta": {"original": len(entries), "deduplicated": len(deduped)},
    }
