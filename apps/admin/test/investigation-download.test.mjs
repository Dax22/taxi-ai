import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createAdminClient,AdminApiError} from '../public/api-client.mjs';

const archive=new TextEncoder().encode('PK TEST CONTENT'),id=randomUUID();
const sha=createHash('sha256').update(archive).digest('hex');
const options={status:200,headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="taxi-ai-evidence-ride-12345678-${id}.zip"`,
  'X-Evidence-SHA256':sha,'X-Evidence-Export-ID':id,'Content-Length':String(archive.length)}};
const url='/api/admin/console/investigations/export';
test('owner download client sends same-origin CSRF and verifies evidence digest before returning any bytes',async()=>{
 let actual;
 const client=createAdminClient({fetchImpl:async(path,opts)=>{actual={path,opts};return new Response(archive,options);}});
 client.setCsrf('fixture-csrf');
 const result=await client.evidenceExport(url,{data:{caseReference:'CASE-001'},key:'fixture-command-key-123'});
 assert.equal(actual.path,url);assert.equal(actual.opts.credentials,'same-origin');assert.equal(actual.opts.cache,'no-store');
 assert.equal(actual.opts.headers['X-CSRF-Token'],'fixture-csrf');assert.equal(actual.opts.headers.Accept,'application/zip');
 assert.equal(result.sha256,sha);assert.equal(result.exportId,id);assert.deepEqual(result.bytes,archive);
});
test('download client refuses an incorrect archive checksum and any unsupported endpoint',async()=>{
 const client=createAdminClient({fetchImpl:async()=>new Response(archive,{...options,headers:{...options.headers,'X-Evidence-SHA256':'a'.repeat(64)}})});
 await assert.rejects(client.evidenceExport(url,{data:{}}),AdminApiError);
 await assert.rejects(client.evidenceExport('/api/admin/console/transactions-export',{data:{}}));
});
