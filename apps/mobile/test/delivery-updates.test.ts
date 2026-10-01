import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryUpdatesController } from '../src/notifications/delivery-controller.ts';
import { pushTarget } from '../src/notifications/push-target.ts';
import { MobileClient } from '../src/api/client.ts';
import type { Account } from '../../../packages/shared/src/mobile-contracts.mjs';
import type { DeliveryUpdate, DeliveryUpdateDetail, DeliveryUpdates, DeliveryUpdateTarget } from '../../../packages/shared/src/delivery-updates.mjs';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const notice: DeliveryUpdate = { id: id(2), kind: 'food', targetId: id(1), phase: 'picked_up', title: 'Kemmy · Food picked up',
  body: 'Delivery takes approximately 15 minutes from pickup.', note: 'Traffic may change it.', etaMinutes: 15, createdAt: 1000, readAt: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(ok => { resolve = ok; }); return { promise, resolve }; }
function fixture(detail = false) {
  const state = { actor: id(3), reads: 0, opens: 0, signal: null as AbortSignal | undefined | null,
    read: null as null | (() => Promise<DeliveryUpdateDetail>), list: { updates: [notice], unread: 1, nextBefore: null } as DeliveryUpdates,
    open: null as null | (() => Promise<DeliveryUpdateTarget>) };
  const api = { account: () => ({ id: state.actor } as Account), deliveryUpdate: async (_kind: string, _target: string, signal?: AbortSignal) => {
    state.reads++; state.signal = signal; return state.read ? state.read() : { update: notice }; },
  deliveryUpdates: async (_before?: string | null, signal?: AbortSignal) => { state.reads++; state.signal = signal; return structuredClone(state.list); },
  openDeliveryUpdate: async (_id: string, signal?: AbortSignal) => { state.opens++; state.signal = signal;
    return state.open ? state.open() : { target: { screen: 'food-order' as const, id: notice.targetId } }; } };
  return { state, controller: new DeliveryUpdatesController(api, detail ? { kind: 'food', targetId: notice.targetId } : null) };
}
test('delivery phone payloads carry only an opaque ID; invalid delivery IDs never fall back to journey navigation', () => {
  assert.deepEqual(pushTarget({ kind: 'delivery', deliveryUpdateId: id(1), url: 'https://evil.test', targetId: id(8) }), { kind: 'delivery', deliveryUpdateId: id(1) });
  for (const deliveryUpdateId of ['../journey', 'g'.repeat(36), 1, null]) assert.equal(pushTarget({ kind: 'delivery', deliveryUpdateId, notificationId: 1 }), null);
});
test('backgrounding cancels delivery requests and prevents late private notices from returning', async () => {
  const { state, controller } = fixture(true), wait = deferred<DeliveryUpdateDetail>();
  state.read = () => wait.promise; controller.activate(); controller.pause();
  assert.equal(state.signal?.aborted, true); wait.resolve({ update: notice }); await tick();
  assert.equal(controller.snapshot().update, null);
  state.read = null; controller.activate(); await tick(); assert.equal(controller.snapshot().update?.etaMinutes, 15);
});
test('delivery state and navigation cannot cross an account change or screen blur', async () => {
  for (const change of ['account', 'blur']) {
    const { state, controller } = fixture(); controller.activate(); await tick();
    const wait = deferred<DeliveryUpdateTarget>(); state.open = () => wait.promise;
    const open = controller.open(notice.id);
    if (change === 'account') state.actor = id(9); else controller.pause();
    wait.resolve({ target: { screen: 'food-order', id: notice.targetId } });
    assert.equal(await open, null); assert.equal(controller.snapshot().updates.length, 0);
  }
});
test('delivery opening suppresses duplicate taps and checks the authorized target against the displayed notice', async () => {
  const { state, controller } = fixture(); controller.activate(); await tick();
  const wait = deferred<DeliveryUpdateTarget>(); state.open = () => wait.promise;
  const first = controller.open(notice.id); assert.equal(await controller.open(notice.id), null); assert.equal(state.opens, 1);
  wait.resolve({ target: { screen: 'journey', id: notice.targetId } });
  assert.equal(await first, null); assert.match(controller.snapshot().error, /target changed/);
  state.open = null; assert.deepEqual(await controller.open(notice.id), { screen: 'food-order', id: notice.targetId });
});
test('delivery pagination deduplicates notices and an authorization failure removes a displayed detail', async () => {
  const f = fixture(); f.state.list.nextBefore = id(8); f.controller.activate(); await tick();
  f.state.list = { updates: [notice, { ...notice, id: id(4) }], nextBefore: null, unread: 2 };
  await f.controller.refresh(true); assert.equal(f.controller.snapshot().updates.length, 2);
  const d = fixture(true); d.controller.activate(); await tick();
  d.state.read = async () => { throw new Error('Access has ended.'); };
  await d.controller.refresh(); assert.equal(d.controller.snapshot().update, null); assert.match(d.controller.snapshot().error, /Access has ended/);
});
test('mobile delivery methods use authenticated API paths and validate returned target identity', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const actor = { id: id(3), name: 'Customer', email: 'customer@example.test', role: 'customer', capabilities: ['customer'], driver: null };
  const env = { apiVersion: 1, serverNow: 1000 };
  const client = new MobileClient({ origin: 'https://taxi.example.test', vault: { read: async () => null, write: async () => {}, clear: async () => {} },
    fetchImpl: (async (input, options) => {
      const url = String(input); calls.push({ url, options: options ?? {} });
      const data = url.endsWith('/auth/login') ? { user: actor, credentials: { sessionId: id(6), accessToken: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accessExpiresAt: 601000, refreshExpiresAt: 604801000 } }
        : url.endsWith('/open') ? { target: { screen: 'food-order', id: notice.targetId } }
        : url.includes('/delivery-updates/food/') ? { update: notice } : { updates: [notice], unread: 1, nextBefore: null };
      return new Response(JSON.stringify({ ...env, ...data }), { status: 200 });
    }) as typeof fetch });
  await client.login(actor.email, 'password', 'Phone');
  assert.equal((await client.deliveryUpdate('food', notice.targetId)).update?.id, notice.id);
  assert.equal((await client.deliveryUpdates(id(4))).updates.length, 1);
  assert.equal((await client.openDeliveryUpdate(notice.id)).target.id, notice.targetId);
  assert.equal(calls[2].url, `https://taxi.example.test/api/mobile/v1/delivery-updates?before=${id(4)}`);
  assert.equal(calls[3].options.method, 'POST');
  for (const call of calls.slice(1)) assert.equal(new Headers(call.options.headers).get('Authorization'), `Bearer ${'a'.repeat(64)}`);
  await assert.rejects(client.deliveryUpdate('food', id(9)), /incompatible delivery update/);
});
