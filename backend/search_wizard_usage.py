import sys
sys.stdout.reconfigure(encoding='utf-8')

content = open('../components/onu-list.tsx', encoding='utf-8').read()
lines = content.split('\n')
for i, line in enumerate(lines):
    if 'ONUConfigWizard' in line or 'configWizard' in line:
        print(f"Line {i+1}: {line.strip()[:120]}")
