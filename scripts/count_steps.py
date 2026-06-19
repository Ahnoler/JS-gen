import re
with open('D:\\dev\\opencode-skill-use\\scripts\\generated\\script_2026-06-19T15-42-30-137Z.js', 'r', encoding='utf-8') as f:
    content = f.read()
steps = re.findall(r"console\.log\('\[(\d+)\]", content)
fills = len(re.findall(r'Fill "', content))
selects = len(re.findall(r'Select "', content))
clicks = len(re.findall(r'Click "', content))
print('Steps:', len(steps), 'from', steps[0], 'to', steps[-1])
print('Fills:', fills, 'Selects:', selects, 'Clicks:', clicks)
