import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/dashboard/kemmy-setup.mjs', import.meta.url), 'utf8');

test('Kemmy account assistant ships as a three-second post-login popup with a persistent launcher', () => {
  assert.match(html, /id="kemmy-setup-card"/);
  assert.match(html, /id="kemmy-setup-launcher"/);
  assert.match(source, /delayMs = 3000/);
  assert.match(source, /Hi, my name is Kemmy and I’m your Taxi Ai assistant/);
  assert.match(source, /Set up my account/);
  assert.match(source, /Book rides & deliveries/);
  assert.match(source, /Drive & deliver/);
  assert.match(source, /Sell food/);
  assert.match(source, /Open Family Safety/);
  assert.doesNotMatch(source, /language model|LLM/i);
});
