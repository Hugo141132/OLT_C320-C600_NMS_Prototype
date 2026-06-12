import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('../components/onu-list.tsx', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    if 'ONU Provisioning Wizard' in l or 'ProvisioningStep' in l or 'Hardware & TCONT' in l or 'wifi_configs' in l:
        print(f"Line {i+1}: {l.strip()[:120]}")
