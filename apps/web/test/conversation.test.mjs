import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationController } from '../public/dashboard/conversation-controller.mjs';
import { conversationItems, offerState } from '../public/dashboard/conversation-model.mjs';

const customer = { id: 'customer', role: 'customer' };
const ride = (id = 'ride-1') => ({ id, version: 2, status: 'negotiating', customer, driver: { id: 'driver' }, negotiation: null });
const page = (rideId, messages = [], extra = {}) => ({ rideId, messages, nextAfter: messages.at(-1)?.sequence ?? 0,
  hasMore: false, lastSequence: messages.at(-1)?.sequence ?? 0, readThrough: 0, unread: messages.length,
  canSend: true, reportedMessageIds: [], ...extra });
function fakeView() {
  return { shown: null, errorText: '', draft: 'Keep this draft', bottom: true,
    open() {}, render(value) { this.shown = structuredClone(value); },
    error(message) { this.errorText = message; }, isAtBottom() { return this.bottom; },
    sent() { this.draft = ''; }, reported() {}, read() {}, reset() { this.shown = null; this.draft = ''; } };
}

test('late chat responses cannot appear in another ride or after sign-out', async () => {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const view = fakeView();
  const controller = createConversationController({ view, visible: () => false,
    client: { request: async (path) => path.includes('ride-1') ? delayed : page('ride-2') } });
  const old = controller.show(ride(), customer);
  await controller.show(ride('ride-2'), customer);
  release(page('ride-1', [{ id: 'secret', sequence: 1, body: 'Old ride content' }]));
  await old;
  assert.equal(view.shown.ride.id, 'ride-2');
  assert.deepEqual(view.shown.messages, []);
  let finish;
  const another = createConversationController({ view, visible: () => false,
    client: { request: () => new Promise((resolve) => { finish = resolve; }) } });
  const outstanding = another.show(ride(), customer);
  another.reset();
  finish(page('ride-1', [{ id: 'private', sequence: 1 }]));
  await outstanding;
  assert.equal(view.shown, null);
});

test('switching account within a shared ride ignores the earlier account response', async () => {
  let resolveOld, call = 0;
  const view = fakeView();
  const controller = createConversationController({ view, visible: () => false, client: {
    request: () => ++call === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(page('ride-1')),
  } });
  const first = controller.show(ride(), customer);
  await controller.show(ride(), { id: 'driver', role: 'driver' });
  assert.equal(view.draft, '', 'changing accounts clears private drafts immediately');
  resolveOld(page('ride-1', [{ id: 'old-session', sequence: 1 }]));
  await first;
  assert.equal(view.shown.user.id, 'driver');
  assert.deepEqual(view.shown.messages, []);
});

test('read markers advance only when visible at the end of the selected conversation', async () => {
  let visible = false;
  const calls = [], view = fakeView();
  const controller = createConversationController({ view, visible: () => visible,
    client: { request: async (path, options) => {
      calls.push({ path, options });
      return options ? { readThrough: 1, unread: 0 } : page('ride-1', [{ id: 'm1', sequence: 1 }]);
    } } });
  await controller.show(ride(), customer);
  assert.equal(calls.length, 1);
  visible = true; view.bottom = false;
  await controller.markRead(); assert.equal(calls.length, 1);
  view.bottom = true;
  await controller.markRead(); await controller.markRead();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.data, { throughSequence: 1 });
});

test('failed sends keep the draft and a changed conversation prevents sending to a new recipient', async () => {
  const view = fakeView(); let sends = 0;
  const controller = createConversationController({ view, visible: () => false, client: {
    request: async () => page('ride-1'), command: async () => { sends++; throw new Error('Offline'); },
  } });
  await controller.show(ride(), customer);
  await assert.rejects(controller.send({ rideId: 'ride-1', userId: customer.id, body: view.draft }), /Offline/);
  assert.equal(view.draft, 'Keep this draft');
  controller.reset();
  await assert.rejects(controller.send({ rideId: 'ride-1', userId: customer.id, body: 'Old draft' }), /conversation changed/);
  assert.equal(sends, 1);
});

test('a failed later message page is retried without duplicated or partially installed history', async () => {
  const view = fakeView(); let call = 0;
  const first = page('ride-1', [{ id: 'm1', sequence: 1 }], { hasMore: true });
  const second = page('ride-1', [{ id: 'm2', sequence: 2 }]);
  const controller = createConversationController({ view, visible: () => false, client: {
    request: async () => { call++; if (call === 2) throw new Error('Lost connection'); return call % 2 ? first : second; },
  } });
  await controller.show(ride(), customer);
  assert.equal(view.shown, null); assert.equal(view.errorText, 'Lost connection');
  await controller.show(ride(), customer);
  assert.deepEqual(view.shown.messages.map((message) => message.id), ['m1', 'm2']);
});

test('fare cards disable old, self-authored, expired and closed offers and show agreement only from server state', () => {
  const old = { id: 'offer:1', proposedBy: 'driver', createdAt: 100, expiresAt: 300, amountKobo: 500000 };
  const current = { ...old, id: 'offer:2', proposedBy: 'customer', amountKobo: 470000 };
  const request = { ...ride(), negotiation: { currentOffer: current, offers: [old, current], agreement: null } };
  assert.equal(offerState(request, old, 'customer', 200).canAccept, false);
  assert.equal(offerState(request, current, 'customer', 200).canAccept, false);
  assert.equal(offerState(request, current, 'driver', 299).canAccept, true);
  assert.equal(offerState(request, current, 'driver', 300).canAccept, false);
  assert.equal(offerState({ ...request, status: 'cancelled' }, current, 'driver', 200).canAccept, false);
  const messages = [{ id: 'm1', sequence: 1, createdAt: 100, body: 'I accept ₦4,700' }];
  assert.equal(conversationItems(request, messages).some((item) => item.kind === 'agreement'), false);
  request.status = 'agreed';
  request.negotiation.agreement = { offerId: current.id, agreedAt: 100, amountKobo: 470000 };
  const items = conversationItems(request, messages);
  assert.deepEqual(items.map((item) => item.kind), ['message', 'offer', 'offer', 'agreement']);
  assert.equal(offerState(request, current, 'driver', 200).label, 'Fare agreed');
  assert.equal(messages.length, 1);
});
