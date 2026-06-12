import sys
sys.stdout.reconfigure(encoding='utf-8')

content = open('main.py', encoding='utf-8').read()
lines = content.split('\n')
for i, line in enumerate(lines):
    if 'class ONUProvisioning' in line or 'class ONUProvisioningStep1Request' in line or 'class ONUProvisioningStep2Request' in line:
        print(f"Line {i+1}: {line.strip()[:120]}")
