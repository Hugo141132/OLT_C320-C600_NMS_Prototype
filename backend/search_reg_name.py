f = open('main.py', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    stripped = l.strip()
    if 'name' in stripped and ('snmp_verification' in stripped or 'ONU-' in stripped or 'onu_id' in stripped):
        print(str(i+1) + ': ' + stripped[:130])
