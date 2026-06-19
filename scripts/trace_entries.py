import json, sys
import re
sys.path.insert(0, '.')
from script_assembler import GENERIC_TAGS

d = json.load(open('../scripts/snapshots/action_20260619_213746.json', encoding='utf-8'))
entries = d['tests'][0]['commands']

print(f'Total entries: {len(entries)}')
for i in range(2, 7):
    e = entries[i]
    label = e.get('propertiesName', '')
    is_generic = (label.lower() in GENERIC_TAGS or bool(re.match(r'^[a-z]+(?:\[\d+\])?$', label)))
    attrs = e.get('attributes', {}) or {}
    cls = (attrs.get('class') or '') if isinstance(attrs, dict) else ''
    readonly = (attrs.get('readonly') or '') if isinstance(attrs, dict) else ''
    placeholder = (attrs.get('placeholder') or '') if isinstance(attrs, dict) else ''
    print(f'i={i} cmd={e["command"]} label="{label}" is_generic={is_generic} cls="{cls}" ph="{placeholder}" ro="{readonly}"')
