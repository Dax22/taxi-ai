#!/usr/bin/env python3
"""Compare a verified runtime export with the implementation base. Never overwrites production."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

RUNTIME_ROOTS=('apps/web/', 'apps/admin/', 'services/api/', 'packages/shared/', 'scripts/')
def relevant(path):
    return path in ('package.json','package-lock.json') or path.startswith(RUNTIME_ROOTS) and '/test/' not in path

def classify(base, runtime, desired):
    if runtime==desired:return 'already_matches_target'
    if runtime==base:return 'safe_patch' if base is not None else 'safe_addition'
    return 'manual_reconciliation_required'

def git(root,*args):
    result=subprocess.run(['git',*args],cwd=root,capture_output=True,check=True)
    return result.stdout

def blob(root,revision,path):
    result=subprocess.run(['git','show',f'{revision}:{path}'],cwd=root,capture_output=True)
    return result.stdout if result.returncode==0 else None

def digest(data):return hashlib.sha256(data).hexdigest() if data is not None else None

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export',type=Path,required=True)
    parser.add_argument('--base',default='88fce65')
    parser.add_argument('--target',default='HEAD')
    args=parser.parse_args();root=Path(__file__).resolve().parents[1]
    base=git(root,'rev-parse','--verify',args.base+'^{commit}').decode().strip()
    target=git(root,'rev-parse','--verify',args.target+'^{commit}').decode().strip()
    directory=args.export.resolve();manifest=json.loads((directory/'manifest.json').read_text())
    records={}
    for item in manifest['files']:
        path=Path(item['path'])
        if path.is_absolute() or '..' in path.parts:raise ValueError('Invalid runtime path')
        resolved=(directory/'source'/path).resolve()
        if not resolved.is_relative_to(directory/'source'):raise ValueError('Runtime path leaves export')
        data=resolved.read_bytes()
        if digest(data)!=item['sha256']:raise ValueError('Runtime export changed since inspection')
        records[str(path)]=data
    changed=git(root,'diff','--name-only',base,target).decode().splitlines()
    comparisons=[]
    for path in changed:
        if relevant(path):comparisons.append({'path':path,'result':classify(blob(root,base,path),records.get(path),blob(root,target,path))})
    drift=[path for path,data in records.items() if path not in changed and blob(root,base,path)!=data]
    report={'runtime':manifest['runtime'],'base':base,'target':target,'comparisons':comparisons,
            'otherRuntimeChangesToPreserve':drift,'productionModified':False,
            'integrationCompleted':False,'note':'Review conflicts and preserve every live-only change. A clean comparison is not deployment authorization.'}
    print(json.dumps(report,indent=2))
    if any(row['result']=='manual_reconciliation_required' for row in comparisons):sys.exit(2)

if __name__=='__main__':
    try:main()
    except Exception:
        print('Runtime reconciliation could not be verified; no source was changed.',file=sys.stderr);sys.exit(1)
