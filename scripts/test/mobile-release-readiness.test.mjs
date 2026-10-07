import test from 'node:test';import assert from 'node:assert/strict';import {releaseReadiness} from '../mobile-release-readiness.mjs';
const appJson={expo:{version:'0.9.0',ios:{bundleIdentifier:'com.taxiai.app'},android:{package:'com.taxiai.app'}}};
const mobilePackage={version:'0.9.0'};
const easJson={build:{acceptance:{extends:'preview',environment:'preview',env:{TAXI_AI_ACCEPTANCE_BUILD:'true'}},preview:{distribution:'internal',environment:'preview',autoIncrement:true,android:{buildType:'apk'}},production:{distribution:'store',environment:'production',autoIncrement:true}}};
const base={EXPO_PUBLIC_EXPO_PROJECT_ID:'11111111-1111-4111-8111-111111111111',EXPO_PUBLIC_API_ORIGIN:'https://taxiai.app',
 EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:'web-client.apps.googleusercontent.com',EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:'ios-client.apps.googleusercontent.com',GOOGLE_MAPS_ANDROID_API_KEY:'A'.repeat(30),GOOGLE_SERVICES_JSON:'/tmp/google-services.json'};

test('iOS acceptance release requires production HTTPS and native Google identity but not Android-only files',()=>{
 const result=releaseReadiness({env:base,platform:'ios',profile:'acceptance',appJson,easJson,mobilePackage,fileExists:()=>false});assert.equal(result.ready,true);
 assert.equal(result.checks.some(c=>c.id==='maps.android'),false);
});
test('Android release refuses a missing or mismatched Firebase client and does not print key material',()=>{
 const result=releaseReadiness({env:base,platform:'android',profile:'acceptance',appJson,easJson,mobilePackage,fileExists:()=>false});assert.equal(result.ready,false);
 assert.equal(result.checks.find(c=>c.id==='firebase.android_file')?.ok,false);assert.equal(JSON.stringify(result).includes(base.GOOGLE_MAPS_ANDROID_API_KEY),false);
});
test('production acceptance build refuses localhost and version drift',()=>{
 const result=releaseReadiness({env:{...base,EXPO_PUBLIC_API_ORIGIN:'http://127.0.0.1:3000'},platform:'ios',profile:'acceptance',
  appJson:{expo:{...appJson.expo,version:'0.8.0'}},easJson,mobilePackage,fileExists:()=>true});assert.equal(result.ready,false);
 assert.equal(result.checks.find(c=>c.id==='api.production')?.ok,false);assert.equal(result.checks.find(c=>c.id==='version.aligned')?.ok,false);
});
