#!/usr/bin/env python3
"""Read-only runtime inventory and allowlisted source export. Never changes a container or database."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SOURCE_JS = r'''
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const roots=['package.json','package-lock.json','apps/web/server.mjs','apps/web/public','apps/admin/public','services/api/src','services/api/migrations','packages/shared/src','scripts'];
const allowed=new Set(['.mjs','.js','.ts','.tsx','.json','.sql','.html','.css']);
const files=[];let size=0;
function walk(relative){
 const full=path.join('/app',relative); if(!fs.existsSync(full))return;
 const info=fs.lstatSync(full);if(info.isSymbolicLink())throw new Error('Source symlink requires review');
 if(info.isDirectory()){for(const item of fs.readdirSync(full).sort())if(!item.startsWith('.')&&!['node_modules','data','backups','secrets'].includes(item))walk(path.join(relative,item));return;}
 if(!info.isFile()||!allowed.has(path.extname(relative)))return;
 const bytes=fs.readFileSync(full);size+=bytes.length;if(size>30000000)throw new Error('Source export exceeds limit');
 files.push({path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')});
}
for(const root of roots)walk(root);
console.log(JSON.stringify({files}));
'''
INVENTORY_JS = r'''
const env=process.env, result={schemaVersion:null,storage:null,activeParcels:null,legacyActiveGrants:null,legacyCompletedGrants:null,clientBuildInventory:'not recorded'};
let query,close;
if(env.TAXI_AI_DATABASE_URL){
 const schema=env.TAXI_AI_DATABASE_SCHEMA??'public';if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw new Error('Unexpected database schema');
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:env.TAXI_AI_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000,options:`-c default_transaction_read_only=on -c search_path=${schema},public`});
 const client=await pool.connect();await client.query('BEGIN READ ONLY');query=async sql=>(await client.query(sql)).rows;close=async()=>{await client.query('ROLLBACK');client.release();await pool.end();};result.storage='postgres';
 const v=await query('SELECT max(version) AS version FROM taxi_schema_migrations');result.schemaVersion=Number(v[0].version);
 result.databaseVersion=(await query('SHOW server_version'))[0].server_version;
}else if(env.TAXI_AI_DB){
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(env.TAXI_AI_DB,{readOnly:true});db.exec('PRAGMA query_only=ON;BEGIN;');query=async sql=>db.prepare(sql).all();close=async()=>{db.exec('ROLLBACK');db.close();};result.storage='sqlite';
 result.schemaVersion=(await query('PRAGMA user_version'))[0].user_version;
}else throw new Error('Storage location unavailable');
try{
 result.admin=await adminReadiness(query,result.storage);
 const active="r.status<>'cancelled' AND (t.status IS NULL OR t.status NOT IN ('completed','cancelled'))";
 result.activeTrips=Number((await query("SELECT count(*) AS n FROM ride_trips WHERE status NOT IN ('completed','cancelled')"))[0].n);
 result.activeParcels=Number((await query(`SELECT count(*) AS n FROM delivery_orders d JOIN rides r ON r.id=d.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE ${active}`))[0].n);
 const columns=result.storage==='postgres'?await query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='parcel_tracking_links'"):await query('PRAGMA table_info(parcel_tracking_links)');
 const unbound=columns.some(c=>c.name==='intended_email_hash')?'l.intended_email_hash IS NULL':'1=1';
 result.legacyActiveGrants=Number((await query(`SELECT count(*) AS n FROM parcel_tracking_links l JOIN rides r ON r.id=l.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE l.active=1 AND ${unbound} AND (${active})`))[0].n);
 result.legacyCompletedGrants=Number((await query(`SELECT count(*) AS n FROM parcel_tracking_links l JOIN rides r ON r.id=l.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE l.active=1 AND l.recipient_id IS NOT NULL AND ${unbound} AND NOT (${active})`))[0].n);
}finally{await close();}
const enumValue=(key,allowed)=>allowed.includes(env[key])?env[key]:null;
result.runtime={mode:enumValue('TAXI_AI_MODE',['local','staging','production']),access:enumValue('TAXI_AI_ACCESS_MODE',['public','invited']),maps:enumValue('TAXI_AI_MAPS_MODE',['off','community','dedicated']),accountEmail:env.TAXI_AI_EMAIL_MODE==='smtp',contactEmail:env.TAXI_AI_CONTACT_EMAIL_MODE==='smtp',push:env.TAXI_AI_PUSH_ENABLED==='true'};
result.readiness=runtimeReadiness(env);
console.log(JSON.stringify(result));
'''
INVENTORY_JS = Path(__file__).with_name('admin-readiness-inventory.mjs').read_text(encoding='utf-8') + '\n' + INVENTORY_JS

def docker(*args, input_text=None):
    result = subprocess.run(['docker', *args], input=input_text, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Docker inspection failed; use an authorized operator terminal. No service was changed.')
    return result.stdout

def metadata(container):
    raw = json.loads(docker('inspect', '--format', '{{json .}}', container))
    labels = raw.get('Config', {}).get('Labels', {})
    return {'containerId':raw['Id'], 'imageId':raw['Image'], 'state':raw['State']['Status'],
            'healthy':raw['State'].get('Health', {}).get('Status'),
            'revisionLabel':labels.get('org.opencontainers.image.revision'),
            'composeProject':labels.get('com.docker.compose.project'),
            'composeService':labels.get('com.docker.compose.service')}

def write_new(path, data):
    with path.open('xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='taxi-ai-staging-app-1')
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}',args.container):parser.error('Invalid container name')
    output=args.output
    if not output.is_absolute() or output.exists() or output.parent.resolve()!=Path('/home/ubuntu') or not output.name.startswith('taxi-ai-live-review-'):
        parser.error('Choose a NEW /home/ubuntu/taxi-ai-live-review-... directory')
    before=metadata(args.container)
    exported=json.loads(docker('exec','-i',args.container,'node','--input-type=module','-',input_text=SOURCE_JS))
    inventory=json.loads(docker('exec','-i',args.container,'node','--experimental-sqlite','--input-type=module','-',input_text=INVENTORY_JS))
    if metadata(args.container)!=before:raise RuntimeError('Runtime changed during inspection. Nothing exported.')
    output.mkdir(mode=0o700)
    manifest=[]
    for record in exported['files']:
        relative=Path(record['path'])
        if relative.is_absolute() or '..' in relative.parts or any(p.startswith('.') for p in relative.parts):raise RuntimeError('Unsafe source path')
        data=base64.b64decode(record['base64'],validate=True)
        if hashlib.sha256(data).hexdigest()!=record['sha256']:raise RuntimeError('Source digest mismatch')
        target=output/'source'/relative;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);write_new(target,data)
        manifest.append({'path':str(relative),'sha256':record['sha256']})
    report={'runtime':before,'inventory':inventory,'files':manifest,'productionModified':False,'containsEnvironmentFiles':False}
    write_new(output/'manifest.json',json.dumps(report,indent=2).encode())
    # Return only this newly created export to the invoking owner, not any production path.
    owner=os.environ.get('SUDO_UID');group=os.environ.get('SUDO_GID')
    if os.geteuid()==0 and owner and group and owner.isdigit() and group.isdigit():
        for path in [*output.rglob('*'),output]:os.chown(path,int(owner),int(group))
    print(json.dumps({'export':str(output),'sourceFiles':len(manifest),'inventory':inventory,'productionModified':False},indent=2))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,RuntimeError) else 'Read-only export did not complete. No service was changed.',file=sys.stderr)
        sys.exit(1)
