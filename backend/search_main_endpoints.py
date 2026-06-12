import sys
sys.stdout.reconfigure(encoding='utf-8')

content = open('main.py', encoding='utf-8').read()
lines = content.split('\n')
for i, line in enumerate(lines):
    if '/api/provisioning/onu/step1' in line or '/api/provisioning/onu/step2' in line or '/api/provisioning/onu/step3' in line:
        print(f"Line {i+1}: {line.strip()[:120]}")
