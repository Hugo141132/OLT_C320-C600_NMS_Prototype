f = open('main.py', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    stripped = l.strip()
    if 'final_name' in stripped or ('name' in stripped and ('pon_index' in stripped or 'shelf' in stripped or 'slot' in stripped)):
        print(str(i+1) + ': ' + stripped[:130])
