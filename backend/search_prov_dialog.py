import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('../components/onu-list.tsx', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    if 'showProvisionWizard' in l or 'provision' in l.lower():
        if 'def ' in l or 'const ' in l or 'function ' in l or 'state' in l or 'dialog' in l.lower() or 'modal' in l.lower():
            print(f"Line {i+1}: {l.strip()[:120]}")
