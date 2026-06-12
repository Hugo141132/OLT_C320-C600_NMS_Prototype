import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('main.py', encoding='utf-8').read()
lines = f.split('\n')
keywords = ['provision', 'tcont', 'gemport', 'service-port', 'vport', 'wifi', 'ssid']
for i, l in enumerate(lines):
    low = l.lower().strip()
    for kw in keywords:
        if kw in low and ('def ' in low or '@app.' in low):
            print(str(i+1) + ': ' + l.strip()[:120])
            break
