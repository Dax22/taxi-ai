import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const webHtml = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const webAuth = await readFile(new URL('../public/dashboard/auth-form.mjs', import.meta.url), 'utf8');
const webGoogle = await readFile(new URL('../public/dashboard/google-auth.mjs', import.meta.url), 'utf8');
const mobileSignIn = await readFile(new URL('../../mobile/app/sign-in.tsx', import.meta.url), 'utf8');
const mobileClient = await readFile(new URL('../../mobile/src/api/client.ts', import.meta.url), 'utf8');
const legacySetup = await readFile(new URL('../../mobile/app/setup-role.tsx', import.meta.url), 'utf8');

test('web registration offers three clear starting experiences under one account', () => {
  for (const label of ['Book &amp; Order','Drive &amp; Deliver','Sell Food']) assert.match(webHtml, new RegExp(label));
  assert.match(webHtml, /You’ll have one Taxi Ai account/);
  assert.match(webHtml, /data-registration-intent="customer"/);
  assert.match(webHtml, /data-registration-intent="driver"/);
  assert.match(webHtml, /data-registration-intent="eats_seller"/);
  assert.match(webAuth, /data\.intent = intent/);
  assert.match(webGoogle, /data: intent \? \{ intent \} : \{\}/);
});

test('native registration mirrors web choices and sends only a starting intent', () => {
  for (const label of ['Book & Order','Drive & Deliver','Sell Food']) assert.match(mobileSignIn, new RegExp(label.replace('&','\\&')));
  assert.match(mobileSignIn, /One account\. Choose how you want to start/);
  assert.match(mobileSignIn, /client\.register\([^\n]+intent/);
  assert.match(mobileSignIn, /creating \? intent : null/);
  assert.match(mobileClient, /data: \{ name, email, password, deviceName, intent \}/);
  assert.match(mobileClient, /data: intent \? \{ intent \} : \{\}/);
});

test('legacy first-device setup no longer presents Customer versus Driver as permanent account types', () => {
  assert.match(legacySetup, /Book & Order/);
  assert.match(legacySetup, /Drive & Deliver/);
  assert.match(legacySetup, /Sell Food/);
  assert.match(legacySetup, /does not create a separate account/);
  assert.doesNotMatch(legacySetup, /Continue as Customer|Continue as Driver/);
});
