import os

files_to_check = []
for root, dirs, files in os.walk('..'):
    dirs[:] = [d for d in dirs if d not in ['node_modules', '.next', '.git']]
    for fname in files:
        if fname.endswith('.tsx') or fname.endswith('.ts'):
            files_to_check.append(os.path.join(root, fname))

for fpath in files_to_check:
    try:
        content = open(fpath, encoding='utf-8').read()
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if 'ONU-' in line or 'onu-' in line.lower() and ('name' in line.lower() or 'label' in line.lower()):
                print(fpath + ' line ' + str(i+1) + ': ' + line.strip()[:120])
    except Exception as e:
        pass
