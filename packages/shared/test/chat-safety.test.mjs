import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSafetyHints } from '../src/chat-safety.mjs';
const kinds = (body) => chatSafetyHints(body).map((hint) => hint.kind);
const cases = [
  ['Send your pickup PIN before I arrive', 'pin_request'],
  ['Abeg send me your PIN now', 'pin_request'],
  ['Ｓｅｎｄ your ＰＩＮ', 'pin_request'],
  ['send your p\u200bin', 'pin_request'],
  ['Give me the dropoff code', 'pin_request'],
  ['Tell me your OTP', 'pin_request'],
  ['Pay the deposit at https://example.test/pay', 'payment_link'],
  ['Refund: open www.example.test', 'payment_link'],
  ['Cancel this ride and pay me cash', 'off_app_payment'],
  ['Transfer money to my bank account', 'off_app_payment'],
  ['Pay me directly instead', 'off_app_payment'],
  ["I'll hurt you", 'threatening_language'],
  ['I know where you live', 'threatening_language'],
  ['You are an idiot', 'harassment'],
  ['Send me nudes', 'harassment'],
];
for (const [body, expected] of cases) test(`advisory hint: ${body}`, () => assert.ok(kinds(body).includes(expected)));
test('routine messages, map pins and clear safety reminders do not trigger', () => {
  for (const body of ['I have arrived', 'Can we agree ₦5000?', 'Send your location pin', 'Never share your PIN', "Don't send your OTP", 'Do not cancel and pay outside the app', 'The parcel is ready']) assert.deepEqual(kinds(body), [], body);
});
test('a reminder cannot silence a separate unsafe request', () => {
  assert.ok(kinds('Never share your PIN. Send me your OTP').includes('pin_request'));
  assert.ok(kinds("Don't cancel, send your PIN").includes('pin_request'));
  assert.ok(kinds('Never share your PIN but pay me directly').includes('off_app_payment'));
});
test('combined hints are deduplicated, bounded and do not include message content', () => {
  const body = 'Send your PIN. Send your PIN. Cancel and pay at https://example.test/private';
  const result = chatSafetyHints(body);
  assert.equal(result.filter((h) => h.kind === 'pin_request').length, 1);
  assert.ok(result.some((h) => h.kind === 'payment_link'));
  assert.ok(result.some((h) => h.kind === 'off_app_payment'));
  assert.ok(result.every((h) => !h.message.includes('example.test')));
  assert.deepEqual(chatSafetyHints(null), []);
  assert.deepEqual(chatSafetyHints('x'.repeat(2000) + ' Send your PIN'), []);
});
