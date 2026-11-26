"""Run once before publishing the initial commit; updates policy and CODEOWNERS."""
import argparse, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
for role in ('lead','frontend','document','voice'):
    p.add_argument('--'+role, required=True)
a = p.parse_args()
users = [a.lead,a.frontend,a.document,a.voice]
if len(set(x.lower() for x in users)) != 4 or any(not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?',x) for x in users):
    p.error('Provide four distinct GitHub usernames without @.')
f = ROOT/'scope-policy.json'; policy = json.loads(f.read_text())
for branch, user in zip(('feature/backend','feature/frontend','feature/document-ai','feature/voice','integration/lead'), users+[a.lead]):
    policy[branch]['owner'] = user
f.write_text(json.dumps(policy,indent=2)+'\n')
(ROOT/'.github/CODEOWNERS').write_text(f'* @{a.lead}\n')
print('Configured branch owners; all paths require lead review where supported.')
