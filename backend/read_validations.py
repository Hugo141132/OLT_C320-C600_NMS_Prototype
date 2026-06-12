import sys
sys.stdout.reconfigure(encoding='utf-8')

f = open('../components/onu-list.tsx', encoding='utf-8').read()
lines = f.split('\n')
for i, l in enumerate(lines):
    if 'canApplyStep1' in l or 'canApplyStep2' in l or 'canApplyStep3' in l:
        print(f"Line {i+1}: {l.strip()[:120]}")
        for j in range(1, 15):
            print(f"  Line {i+1+j}: {lines[i+j][:120]}")
