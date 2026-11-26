"""Validate net changed paths. Run from a trusted checkout for review/CI."""
import argparse, json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)
def changed(*args):
    return [x.decode('utf-8','surrogateescape') for x in git('diff','--name-only','--no-renames','-z',*args).split(b'\0') if x]
def allowed(path, scopes):
    return any(s == '*' or (s.endswith('/') and path.startswith(s)) or (not s.endswith('/') and path == s) for s in scopes)
def validate(branch, paths, actor=None):
    policy = json.loads((ROOT/'scope-policy.json').read_text())
    if branch not in policy:
        raise ValueError(f'Unknown or protected branch: {branch}')
    entry=policy[branch]
    if actor is not None and (entry['owner'].startswith('UNCONFIGURED_') or actor.lower()!=entry['owner'].lower()):
        raise ValueError(f'PR author {actor!r} is not assigned to {branch!r}')
    bad = sorted({p for p in paths if not allowed(p,entry['paths'])})
    if bad:
        raise ValueError('Out-of-scope paths:\n'+'\n'.join(repr(p) for p in bad))
    print(f'Scope OK: {branch}, {len(paths)} changed path(s).')
def main():
    p=argparse.ArgumentParser(); p.add_argument('--branch'); p.add_argument('--actor'); p.add_argument('--base'); p.add_argument('--head',default='HEAD'); p.add_argument('--staged',action='store_true'); a=p.parse_args()
    branch=a.branch or git('branch','--show-current').decode().strip()
    if bool(a.base)==a.staged:
        p.error('Choose exactly one of --base or --staged')
    paths=changed('--cached','--') if a.staged else changed(f'{a.base}...{a.head}','--')
    validate(branch,paths,a.actor)
if __name__=='__main__':
    try: main()
    except (ValueError, subprocess.CalledProcessError, OSError) as e:
        print(f'SCOPE REJECTED: {e}',file=sys.stderr); sys.exit(1)
