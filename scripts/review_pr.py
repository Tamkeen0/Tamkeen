"""Lead-only trusted local gate. Does not merge or execute PR code."""
import json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def run(*args):
    return subprocess.check_output(args,cwd=ROOT,text=True).strip()
if len(sys.argv)!=2 or not sys.argv[1].isdigit():
    raise SystemExit('Usage: python scripts/review_pr.py PR_NUMBER')
n=sys.argv[1]
if run('git','branch','--show-current')!='main' or run('git','status','--porcelain'):
    raise SystemExit('Use a clean, trusted main checkout.')
run('git','fetch','--no-tags','origin','main:refs/remotes/origin/main')
if run('git','rev-parse','HEAD')!=run('git','rev-parse','origin/main'):
    raise SystemExit('Run git pull --ff-only origin main first.')
pr=json.loads(run('gh','pr','view',n,'--json','author,headRefName,headRefOid,baseRefName,state'))
if pr['baseRefName']!='main' or pr['state']!='OPEN':
    raise SystemExit('Expected open PR targeting main.')
run('git','fetch','--no-tags','origin',f'refs/pull/{n}/head')
sha=run('git','rev-parse','FETCH_HEAD')
if sha!=pr['headRefOid']:
    raise SystemExit('PR changed during review. Retry.')
subprocess.run([sys.executable,str(ROOT/'scripts/scope_guard.py'),'--branch',pr['headRefName'],'--actor',pr['author']['login'],'--base','origin/main','--head',sha],check=True,cwd=ROOT)
print(f'Inspect and test SHA {sha} before merging. Do not run untrusted code with secrets.')
print(f'After review: gh pr merge {n} --squash --match-head-commit {sha}')
