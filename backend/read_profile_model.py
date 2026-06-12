import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('main.py', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    if 'class OLTProfile' in l or 'class Profile' in l:
        print(f"Line {i+1}: {l.strip()}")
        for j in range(1, 25):
            print(f"Line {i+1+j}: {lines[i+j]}")
