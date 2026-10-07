import test from 'node:test';import assert from 'node:assert/strict';import {permissions} from '../src/modules/staff-access/domain.mjs';
test('owner and operations can monitor/manage native devices while other staff roles cannot',()=>{
 for(const role of ['owner','operations']){assert.ok(permissions(role).includes('mobile.read'));assert.ok(permissions(role).includes('mobile.manage'));}
 for(const role of ['support','safety','finance']){assert.equal(permissions(role).includes('mobile.read'),false);assert.equal(permissions(role).includes('mobile.manage'),false);}
});
