import pathlib
p = pathlib.Path(r'd:\OneDrive\المستندات\البرنامج\project\src\components\ExamsView.tsx')
lines = p.read_text(encoding='utf-8').splitlines(keepends=True)
for i, ln in enumerate(lines):
    s = ln.strip()
    if 'setDescription' in s or ('description' in s.lower() and 'usestate' in s.lower()):
        print(i + 1, repr(ln[:150]))
print('SCAN_DONE total=', len(lines))
