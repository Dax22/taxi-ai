import test from 'node:test';
import assert from 'node:assert/strict';
import { restrictionInput, effective, visible, scopesFor } from '../src/modules/account-controls/domain.mjs';
import { requireUnrestricted, requireNewDriverWork } from '../src/shared/service-restrictions.mjs';

const now=1800000000000;
const sample={subjectType:'account',subjectId:'10000000-0000-4000-8000-000000000001',scope:'customer',kind:'suspension',reasonCode:'conduct',reason:'Internal review explanation',notice:'A service restriction is under review.',caseReference:'TEST-ONLY',expiresAt:now+100000,reviewAt:now+50000,confirmation:'CONFIRM'};
test('moderation validates dates, scope and explicit acknowledgement',()=>{
 assert.equal(restrictionInput(sample,now).scope,'customer');
 for(const change of [{confirmation:''},{scope:'root'},{subjectType:'store'},{reviewAt:null},{reviewAt:now-1},{expiresAt:now-1}])assert.throws(()=>restrictionInput({...sample,...change},now));
 assert.ok(restrictionInput(sample,null));
});
test('public notices exclude evidence and expire without changing identity or documents',()=>{
 const row={...restrictionInput(sample,now),status:'active',createdBy:'private-staff-id'};
 assert.equal(effective(row,now),true);assert.equal(effective(row,row.expiresAt),false);
 const publicValue=visible(row,now);assert.equal(publicValue.privateReason,undefined);assert.equal(publicValue.createdBy,undefined);
 assert.equal(visible(row,row.expiresAt).status,'expired');
 assert.deepEqual(scopesFor({role:'operations'}),['driver','vehicle','vendor','store']);
 assert.ok(!scopesFor({role:'safety'}).includes('account'));assert.deepEqual(scopesFor({role:'finance'}),[]);
});
test('new service guards do not confuse customer and driver restrictions',()=>{
 const customerOnly={restrictions:{scopes:['customer']}};
 assert.throws(()=>requireUnrestricted(customerOnly,'customer'));
 assert.doesNotThrow(()=>requireNewDriverWork(customerOnly));
 assert.throws(()=>requireNewDriverWork({restrictions:{scopes:['vehicle']}}));
 assert.throws(()=>requireUnrestricted({restrictions:{scopes:['account']}},'vendor'));
 assert.doesNotThrow(()=>requireUnrestricted({restrictions:{scopes:[]}},'customer'));
});
