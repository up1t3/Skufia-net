import json, sys
sys.stdout.reconfigure(encoding='utf-8')

with open('.coverage_unit.json') as f:
    d = json.load(f)

totals = d['totals']
files  = d['files']

print('=' * 60)
print('  UNIT TEST COVERAGE REPORT')
print('=' * 60)
for fn, info in files.items():
    name = fn.split('\\')[-1].split('/')[-1]
    pct  = info['summary']['percent_covered']
    stmts = info['summary']['num_statements']
    miss  = info['summary']['missing_lines']
    miss_lines = info.get('missing_lines', [])
    bar   = '█' * int(pct / 5) + '░' * (20 - int(pct / 5))
    print(f'  {name:40s} {bar} {pct:5.1f}%  ({stmts} stmts, {miss} missed)')
    if miss_lines and pct < 100:
        print(f'    Missing lines: {miss_lines[:10]}')

print()
total_stmts = totals['num_statements']
total_miss  = totals['missing_lines']
total_pct   = totals['percent_covered']
bar = '█' * int(total_pct / 5) + '░' * (20 - int(total_pct / 5))
print(f'  {"TOTAL":40s} {bar} {total_pct:5.1f}%  ({total_stmts} stmts, {total_miss} missed)')
print('=' * 60)
