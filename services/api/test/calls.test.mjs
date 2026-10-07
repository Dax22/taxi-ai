import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TEST_NOW, harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { createApplication } from '../src/application.mjs';

const SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:example\r\na=ice-pwd:example-test-password\r\na=fingerprint:sha-256 AA:BB:CC\r\na=candidate:1 1 UDP 100 127.0.0.1 12345 typ host\r\n';
function windowFor(client, clientId = randomUUID()) {
  return { clientId,
    get: (path) => client.send(path, { headers: { 'X-Call-Client': clientId } }),
    post: (path, data, key = randomUUID()) => client.send(path, { method: 'POST', data,
      headers: { 'X-Call-Client': clientId, 'Idempotency-Key': key } }),
  };
}
async function setup(t, options) {
  const h = await harness(t, options);
  const people = await participants(h);
  const ride = await claimRide(people.driver, await requestRide(people.customer));
  const caller = windowFor(people.customer), callee = windowFor(people.driver);
  return { h, ...people, ride, caller, callee };
}
async function start(caller, ride, key) {
  const response = await caller.post(`/api/rides/${ride.id}/calls`, {}, key);
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.call;
}
async function answer(callee, call) {
  const response = await callee.post(`/api/calls/${call.id}/accept`, { expectedVersion: call.version });
  assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.call;
}
async function signal(window, call, type, sdp = SDP, key) {
  const result = await window.post(`/api/calls/${call.id}/signal`, { type, sdp }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result;
}

test('audio signaling is participant-only, answer-gated, session/tab-owned and absent from call metadata', async (t) => {
  const { h, customer, driver, admin, ride, caller, callee } = await setup(t);
  const outside = h.client(); await outside.register('outsider');
  const outsider = windowFor(outside), operator = windowFor(admin), otherTab = windowFor(driver);
  const key = randomUUID();
  const call = await start(caller, ride, key);
  assert.equal(call.status, 'ringing'); assert.equal(call.owned, true);
  const replay = await caller.post(`/api/rides/${ride.id}/calls`, {}, key);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.call.id, call.id);
  const incoming = (await callee.get('/api/calls')).body.active;
  assert.equal(incoming.caller.name, 'customer'); assert.equal(incoming.owned, false);
  assert.equal((await caller.get(`/api/calls/${call.id}/media`)).body.error.code, 'CALL_CLOSED');
  assert.equal((await caller.post(`/api/calls/${call.id}/accept`, { expectedVersion: 0 })).status, 403);
  assert.equal((await operator.get('/api/calls')).status, 403);
  assert.equal((await outsider.get(`/api/calls/${call.id}/media`)).status, 404);
  assert.equal((await outsider.post(`/api/calls/${call.id}/end`, { reason: 'hangup' })).status, 404);
  assert.equal((await windowFor(h.client()).get('/api/calls')).status, 401);
  const badCsrf = await customer.send(`/api/calls/${call.id}/end`, { method: 'POST', data: { reason: 'hangup' },
    headers: { 'X-Call-Client': caller.clientId, 'X-CSRF-Token': 'wrong', 'Idempotency-Key': randomUUID() } });
  assert.equal(badCsrf.status, 403);
  await answer(callee, call);
  assert.equal((await otherTab.get(`/api/calls/${call.id}/media`)).body.error.code, 'CALL_WINDOW');
  assert.equal((await otherTab.post(`/api/calls/${call.id}/pulse`, { connected: true })).body.error.code, 'CALL_WINDOW');
  assert.equal((await otherTab.post(`/api/calls/${call.id}/signal`, { type: 'answer', sdp: SDP })).body.error.code, 'CALL_WINDOW');
  assert.equal((await callee.post(`/api/calls/${call.id}/signal`, { type: 'offer', sdp: SDP })).status, 400);
  assert.equal((await callee.post(`/api/calls/${call.id}/signal`, { type: 'answer', sdp: SDP })).status, 400);
  await signal(caller, call, 'offer');
  const details = (await callee.get(`/api/calls/${call.id}/media`)).body;
  assert.deepEqual(details.remoteDescription, { type: 'offer', sdp: SDP });
  assert.deepEqual(details.configuration.iceServers, []);
  await signal(callee, call, 'answer');
  assert.equal((await caller.get(`/api/calls/${call.id}/media`)).body.remoteDescription.type, 'answer');
  const text = JSON.stringify((await caller.get('/api/calls')).body);
  for (const secret of ['@example.test', 'sdp', 'fingerprint', 'csrf', 'callerSession', 'callerClient', 'phone']) assert.ok(!text.includes(secret), secret);
  assert.equal((await caller.post(`/api/calls/${call.id}/pulse`, { connected: true })).body.call.status, 'connecting');
  assert.equal((await callee.post(`/api/calls/${call.id}/pulse`, { connected: true })).body.call.status, 'connected');
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.negotiation.agreement, null, 'calling never agrees a fare');
});

test('competing calls and competing answer windows cannot claim the same participant twice', async (t) => {
  const { h, customer, driver, ride, caller, callee } = await setup(t);
  const calls = await Promise.all([caller, callee].map((window) => window.post(`/api/rides/${ride.id}/calls`, {})));
  assert.deepEqual(calls.map((r) => r.status).sort(), [201, 409]);
  assert.equal(calls.find((r) => r.status === 409).body.error.code, 'CALL_BUSY');
  const winner = calls.find((r) => r.status === 201).body.call;
  const recipient = winner.callee.id === driver.user.id ? callee : caller;
  // A second tab shares the authenticated recipient cookie, not its audio ownership.
  const second = windowFor(recipient === callee ? driver : customer);
  const answers = await Promise.all([recipient, second].map((window) => window.post(`/api/calls/${winner.id}/accept`, { expectedVersion: 0 })));
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 409]);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_participants').get().n, 2);
});

test('declines, missed calls and expired sessions release locks and remain in history after restart', async (t) => {
  const { h, customer, ride, caller, callee } = await setup(t, { persistent: true });
  let call = await start(caller, ride);
  const declined = await callee.post(`/api/calls/${call.id}/decline`, { expectedVersion: 0 });
  assert.equal(declined.body.call.status, 'declined');
  assert.equal((await caller.get('/api/calls')).body.active, null);
  call = await start(caller, ride);
  h.advance(44_999);
  // Timeout wins at the exact ring deadline (rather than trusting a browser clock).
  h.advance(1);
  const late = await callee.post(`/api/calls/${call.id}/accept`, { expectedVersion: 0 });
  assert.equal(late.body.error.code, 'CALL_CLOSED');
  assert.equal((await caller.get('/api/calls')).body.recent.find((entry) => entry.id === call.id).status, 'missed');
  await h.restart();
  assert.equal((await callee.get('/api/calls')).body.recent.length, 2);
  h.advance(60_001);
  call = await start(caller, ride); await answer(callee, call);
  await signal(caller, call, 'offer');
  await customer.post('/api/auth/logout');
  assert.equal((await callee.get('/api/calls')).body.active, null);
  assert.equal((await callee.get('/api/calls')).body.recent[0].reason, 'session_ended');
  const row = h.db.prepare('SELECT offer_sdp, answer_sdp, caller_session, caller_client FROM voice_calls WHERE id = ?').get(call.id);
  assert.equal(row.offer_sdp, null); assert.equal(row.answer_sdp, null); assert.equal(row.caller_session, ''); assert.equal(row.caller_client, '');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_participants').get().n, 0);
});

test('SDP is bounded audio-only data; wrong roles, replacement and late signals are rejected', async (t) => {
  const { ride, caller, callee } = await setup(t);
  const call = await start(caller, ride); await answer(callee, call);
  for (const sdp of ['', SDP.replace('m=audio', 'm=video'), SDP + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
    SDP.replace('a=fingerprint:sha-256 AA:BB:CC\r\n', ''), 'x'.repeat(12001), SDP + '\u0000']) {
    assert.equal((await caller.post(`/api/calls/${call.id}/signal`, { type: 'offer', sdp })).status, 400);
  }
  const key = randomUUID();
  await signal(caller, call, 'offer', SDP, key);
  assert.equal((await signal(caller, call, 'offer', SDP, key)).body.replayed, true);
  assert.equal((await caller.post(`/api/calls/${call.id}/signal`, { type: 'offer', sdp: SDP.replace('12345', '12346') }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await caller.post(`/api/calls/${call.id}/signal`, { type: 'offer', sdp: SDP.replace('12345', '12346') })).body.error.code, 'CALL_SIGNAL_EXISTS');
  await caller.post(`/api/calls/${call.id}/end`, { reason: 'hangup' });
  assert.equal((await callee.post(`/api/calls/${call.id}/signal`, { type: 'answer', sdp: SDP })).body.error.code, 'CALL_CLOSED');
  assert.equal((await signal(caller, call, 'offer', SDP, key)).body.call.status, 'ended');
});

test('trip closure atomically ends a call, erases live SDP and rolls back together if the ride write fails', async (t) => {
  const { h, customer, ride, caller, callee } = await setup(t);
  const call = await start(caller, ride); await answer(callee, call); await signal(caller, call, 'offer');
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_ride_key BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'test fault'); END");
  const failed = await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version }, key);
  assert.equal(failed.status, 500);
  assert.equal((await caller.get('/api/calls')).body.active.status, 'connecting');
  assert.equal(h.db.prepare('SELECT offer_sdp FROM voice_calls WHERE id = ?').get(call.id).offer_sdp, SDP);
  h.db.exec('DROP TRIGGER fail_ride_key');
  assert.equal((await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version }, key)).status, 200);
  assert.equal((await callee.get('/api/calls')).body.active, null);
  assert.equal((await callee.get('/api/calls')).body.recent[0].reason, 'ride_closed');
  assert.equal(h.db.prepare('SELECT offer_sdp FROM voice_calls WHERE id = ?').get(call.id).offer_sdp, null);
  assert.equal((await caller.post(`/api/rides/${ride.id}/calls`, {})).body.error.code, 'CALL_UNAVAILABLE');
});

test('call writes are atomic and the original create/end keys can be retried without duplicate history', async (t) => {
  const { h, ride, caller } = await setup(t);
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_call_key BEFORE INSERT ON voice_commands BEGIN SELECT RAISE(ABORT, 'test fault'); END");
  assert.equal((await caller.post(`/api/rides/${ride.id}/calls`, {}, key)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_calls').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_participants').get().n, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind LIKE 'call.%'").get().n, 0);
  h.db.exec('DROP TRIGGER fail_call_key');
  const call = await start(caller, ride, key);
  const endKey = randomUUID();
  for (let i = 0; i < 2; i++) assert.equal((await caller.post(`/api/calls/${call.id}/end`, { reason: 'hangup' }, endKey)).status, 200);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'call.ended'").get().n, 1);
  assert.equal((await caller.post(`/api/rides/${ride.id}/calls`, {}, key)).body.call.status, 'ended');
  assert.equal((await caller.get('/api/calls')).body.recent.length, 1);
});

test('heartbeat loss and connection deadline close calls; a different login cannot revive old audio ownership', async (t) => {
  const { h, customer, ride, caller, callee } = await setup(t, { persistent: true });
  let call = await start(caller, ride); await answer(callee, call);
  h.advance(29_999); await caller.post(`/api/calls/${call.id}/pulse`, { connected: false });
  h.advance(1);
  assert.equal((await caller.get('/api/calls')).body.recent[0].reason, 'connection_lost');
  h.advance(60_001); call = await start(caller, ride); await answer(callee, call);
  h.advance(25_000);
  for (const window of [caller, callee]) await window.post(`/api/calls/${call.id}/pulse`, { connected: true });
  assert.equal((await caller.get('/api/calls')).body.active.status, 'connecting', 'claims alone do not complete the handshake');
  h.advance(20_000);
  assert.equal((await caller.get('/api/calls')).body.recent[0].reason, 'connection_timeout');
  h.advance(60_001); call = await start(caller, ride); await answer(callee, call);
  await h.restart();
  assert.equal((await caller.get('/api/calls')).body.active.owned, true);
  await customer.post('/api/auth/login', { email: customer.user.email, password: PASSWORD });
  assert.equal((await caller.get('/api/calls')).body.active, null);
  assert.equal((await callee.get('/api/calls')).body.recent[0].reason, 'session_ended');
});

test('relay credentials are limited to answered owned calls; relay mode rejects direct candidates and off mode rejects calls', async (t) => {
  const secret = 'test-only-shared-turn-secret-32-characters';
  const config = createCallConfig({ TAXI_AI_CALLS_MODE: 'relay', TAXI_AI_TURN_URLS: 'turn:relay.example.test:3478?transport=udp', TAXI_AI_TURN_SECRET: secret });
  const { ride, caller, callee } = await setup(t, { callConfig: config });
  const call = await start(caller, ride); await answer(callee, call);
  const media = await caller.get(`/api/calls/${call.id}/media`);
  assert.equal(media.body.configuration.iceTransportPolicy, 'relay');
  assert.equal(media.body.configuration.iceServers[0].username.split(':')[0], String(Math.floor(TEST_NOW / 1000) + 3600));
  assert.ok(!JSON.stringify(media.body).includes(secret));
  assert.equal((await caller.post(`/api/calls/${call.id}/signal`, { type: 'offer', sdp: SDP })).status, 400);
  await signal(caller, call, 'offer', SDP.replace('typ host', 'typ relay'));
  const off = await setup(t, { callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }) });
  assert.equal((await off.caller.get('/api/calls')).body.settings.enabled, false);
  assert.equal((await off.caller.post(`/api/rides/${off.ride.id}/calls`, {})).body.error.code, 'CALL_UNAVAILABLE');
});

test('redial limits, maximum duration and configuration changes cannot leave participant locks or live SDP behind', async (t) => {
  const { h, ride, caller, callee } = await setup(t);
  for (let i = 0; i < 5; i++) {
    const call = await start(caller, ride);
    await callee.post(`/api/calls/${call.id}/decline`, { expectedVersion: 0 });
  }
  assert.equal((await caller.post(`/api/rides/${ride.id}/calls`, {})).status, 429);
  h.advance(60_001);
  let call = await start(caller, ride); await answer(callee, call);
  await signal(caller, call, 'offer'); await signal(callee, call, 'answer');
  for (const window of [caller, callee]) await window.post(`/api/calls/${call.id}/pulse`, { connected: true });
  h.advance(30 * 60_000);
  assert.equal((await caller.get('/api/calls')).body.recent[0].reason, 'max_duration');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_participants').get().n, 0);
  call = await start(caller, ride); await answer(callee, call); await signal(caller, call, 'offer');
  (await createApplication({ db: h.db, clock: () => (TEST_NOW + 1_860_001), callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }) }).calls.sweep());
  assert.equal((await caller.get('/api/calls')).body.recent[0].reason, 'unavailable');
  assert.equal(h.db.prepare('SELECT offer_sdp FROM voice_calls WHERE id = ?').get(call.id).offer_sdp, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM voice_participants').get().n, 0);
});

test('native device sessions can own masked calls without exposing call ownership to another signed-in device', async (t) => {
  const { h, customer, driver, ride } = await setup(t);
  async function login(actor,name) {
    const response=await fetch(h.base+'/api/mobile/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor.user.email,password:PASSWORD,deviceName:name})});
    assert.equal(response.status,200);return (await response.json()).credentials;
  }
  const customerPhone=await login(customer,'Customer native phone'),driverPhone=await login(driver,'Driver native phone'),otherCustomer=await login(customer,'Other customer phone');
  const send=async(credentials,path,{data,key=randomUUID()}={})=>{
    const response=await fetch(h.base+'/api/mobile/v1'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${credentials.accessToken}`,...(data===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,body:await response.json()};
  };
  let started=await send(customerPhone,`/rides/${ride.id}/calls`,{data:{}});assert.equal(started.status,200,JSON.stringify(started.body));const call=started.body.call;assert.equal(call.owned,true);
  const incoming=await send(driverPhone,'/calls');assert.equal(incoming.body.active.id,call.id);assert.equal(incoming.body.active.owned,false);
  const other=await send(otherCustomer,'/calls');assert.equal(other.body.active.id,call.id);assert.equal(other.body.active.owned,false);
  const accepted=await send(driverPhone,`/calls/${call.id}/accept`,{data:{expectedVersion:call.version}});assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal((await send(otherCustomer,`/calls/${call.id}/media`)).body.error.code,'CALL_WINDOW');
  const callerMedia=await send(customerPhone,`/calls/${call.id}/media`);assert.equal(callerMedia.status,200);assert.deepEqual(callerMedia.body.configuration.iceServers,[]);
  const offer=await send(customerPhone,`/calls/${call.id}/signal`,{data:{type:'offer',sdp:SDP}});assert.equal(offer.status,200,JSON.stringify(offer.body));
  const calleeMedia=await send(driverPhone,`/calls/${call.id}/media`);assert.deepEqual(calleeMedia.body.remoteDescription,{type:'offer',sdp:SDP});
  const answerResult=await send(driverPhone,`/calls/${call.id}/signal`,{data:{type:'answer',sdp:SDP}});assert.equal(answerResult.status,200);
  assert.equal((await send(customerPhone,`/calls/${call.id}/pulse`,{data:{connected:true}})).status,200);
  assert.equal((await send(driverPhone,`/calls/${call.id}/pulse`,{data:{connected:true}})).body.call.status,'connected');
});
