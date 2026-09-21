import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailConfig } from '../src/infrastructure/email-config.mjs';
import { createAccountMail } from '../src/infrastructure/account-mail.mjs';

const env = { TAXI_AI_EMAIL_MODE:'smtp',TAXI_AI_SMTP_HOST:'smtp.example.test',TAXI_AI_SMTP_PORT:'465',
  TAXI_AI_SMTP_USER:'fixture-user',TAXI_AI_SMTP_PASSWORD:'fixture-private-secret',TAXI_AI_SMTP_FROM:'accounts@example.test' };
test('email configuration is explicit, validates TLS and sender settings and uses only the configured website origin', () => {
  assert.deepEqual(createEmailConfig({}),{enabled:false});
  for (const override of [{TAXI_AI_EMAIL_MODE:'invalid'},{TAXI_AI_EMAIL_MODE:'off'},{TAXI_AI_SMTP_PASSWORD:''},
    {TAXI_AI_SMTP_HOST:'https://attacker.example/path'},{TAXI_AI_SMTP_HOST:'127.0.0.1'},{TAXI_AI_SMTP_PORT:'25'},
    {TAXI_AI_SMTP_FROM:'first@example.test,second@example.test'},{TAXI_AI_SMTP_FROM:'safe@example.test\r\nBcc:other@example.test'}]) {
    assert.throws(()=>createEmailConfig({...env,...override}));
  }
  assert.equal(createEmailConfig(env,{mode:'local',port:3001,publicOrigin:'https://unused.example'}).origin,'http://localhost:3001');
  assert.equal(createEmailConfig(env,{mode:'staging',publicOrigin:'https://taxi.example.test'}).origin,'https://taxi.example.test');
  assert.throws(()=>createEmailConfig(env,{mode:'staging',publicOrigin:'http://taxi.example.test'}));
});

test('SMTP adapter requires validated TLS, disables content fetches/logging and sends fixed single-recipient fragment links', async () => {
  let options, closed=false; const messages=[];
  const mail=createAccountMail({config:createEmailConfig(env,{mode:'staging',publicOrigin:'https://taxi.example.test'}),transportFactory:(value)=>{
    options=value; return {sendMail:async(message)=>{messages.push(message);return {accepted:[message.envelope.to[0]],rejected:[]};},close(){closed=true;}};
  }});
  assert.equal(options.secure,true); assert.equal(options.requireTLS,true); assert.equal(options.tls.rejectUnauthorized,true);
  assert.equal(options.tls.minVersion,'TLSv1.2'); assert.equal(options.disableFileAccess,true); assert.equal(options.disableUrlAccess,true);
  assert.equal(options.logger,false); assert.equal(options.debug,false); assert.equal(options.maxConnections,1);
  for (const purpose of ['verify','reset','changed']) await mail.send({email:'recipient@example.test',purpose,token:'a'.repeat(64)});
  assert.deepEqual(messages[0].envelope,{from:'accounts@example.test',to:['recipient@example.test']});
  assert.match(messages[0].text,/https:\/\/taxi\.example\.test\/account-recovery#verify=[a-f0-9]{64}/);
  assert.match(messages[1].text,/#reset=/); assert.ok(!messages[2].text.includes('a'.repeat(64)));
  assert.ok(!JSON.stringify(messages).includes(env.TAXI_AI_SMTP_PASSWORD));
  await assert.rejects(mail.send({email:'safe@example.test,other@example.test',purpose:'reset',token:'a'.repeat(64)}));
  mail.close(); assert.equal(closed,true);
});

test('STARTTLS cannot downgrade and provider rejection is a failed delivery', async () => {
  let options;
  const mail=createAccountMail({config:createEmailConfig({...env,TAXI_AI_SMTP_PORT:'587'}),transportFactory:(value)=>{
    options=value; return {sendMail:async()=>({accepted:[],rejected:['recipient@example.test']}),close(){}};
  }});
  assert.equal(options.secure,false); assert.equal(options.requireTLS,true);
  await assert.rejects(mail.send({email:'recipient@example.test',purpose:'reset',token:'b'.repeat(64)}));
  await assert.rejects(createAccountMail().send({}));
});
