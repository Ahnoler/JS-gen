"""JS string escaping helpers for Playwright script code generation.

Extracted verbatim from scripts/script_assembler.py (Action-to-Code
Mapping section).
"""


def _escape(s):
    """Escape single quotes for JS strings."""
    return s.replace('\\', '\\\\').replace("'", "\\'") if s else ''


def _escape_js_string(s):
    """Escape a string for use inside a JS template literal or string."""
    if not s:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')


def _xpath_literal_py(text):
    """Build an XPath string literal for text matching."""
    t = str(text or '')
    if "'" not in t:
        return f"'{t}'"
    if '"' not in t:
        return f'"{t}"'
    parts = t.split("'")
    return 'concat(' + ', "\'", '.join(f"'{p}'" for p in parts) + ')'
