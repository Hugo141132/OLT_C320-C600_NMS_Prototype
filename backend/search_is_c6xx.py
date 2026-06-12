import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('../components/onu-list.tsx', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    if 'function ProvisioningWizard' in l or 'const ProvisioningWizard' in l or 'isC6xx' in l:
        print(f"Line {i+1}: {l.strip()[:120]}")
