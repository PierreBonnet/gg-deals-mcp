import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DealsClient } from '../src/client.js';

const game = { title: 'Fixture Game', url: 'https://gg.deals/game/fixture/', prices: {
  currentRetail: '12.99', currentKeyshops: '8.00', historicalRetail: '0.00', historicalKeyshops: null, currency: 'EUR',
} };
const reply = data => Response.json({ success: true, data });
const clientWith = (fetchImpl, options = {}) => new DealsClient({ apiKey: 'secret-fixture', fetchImpl, ...options });

for (const kind of ['app', 'sub', 'bundle']) test(`${kind}: correct route, region, IDs, prices and unknown item`, async () => {
  const client = clientWith(async (url, options) => {
    assert.equal(url.origin, 'https://api.gg.deals');
    assert.equal(url.pathname, `/v1/prices/by-steam-${kind}-id/`);
    assert.equal(url.searchParams.get('ids'), '420,1');
    assert.equal(url.searchParams.get('region'), 'fr');
    assert.equal(url.searchParams.get('key'), 'secret-fixture');
    assert.equal(options.redirect, 'error');
    return reply({ 420: game, 1: null });
  });
  const result = await client.prices(kind, { ids: [420, 420, 1] });
  assert.deepEqual(result.data, { 420: game, 1: null });
  assert.equal(result.requestedRecords, 2);
});

test('validates before any network request', async () => {
  const client = clientWith(() => assert.fail('network must not be called'));
  for (const args of [{ ids: [] }, { ids: [0] }, { ids: [-1] }, { ids: [1.2] }, { ids: ['1'] }, { ids: [Number.MAX_SAFE_INTEGER + 1] }, { ids: Array(101).fill(1) }, { ids: [1], region: 'xx' }]) {
    await assert.rejects(client.prices('app', args), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(client.prices('other', { ids: [1] }), { code: 'INVALID_INPUT' });
  await assert.rejects(clientWith(() => {}, { apiKey: '' }).prices('app', { ids: [1] }), { code: 'MISSING_API_KEY' });
  await assert.rejects(clientWith(() => {}, { region: 'bad' }).prices('app', { ids: [1] }), { code: 'INVALID_REGION' });
});

test('cache supports overlap, null, expiry, separate regions and ID types', async () => {
  let now = 0;
  const requests = [];
  const client = clientWith(async url => {
    requests.push(url.searchParams.get('ids'));
    return reply(Object.fromEntries(url.searchParams.get('ids').split(',').map(id => [id, null])));
  }, { now: () => now });
  await client.prices('app', { ids: [1, 2] });
  const overlap = await client.prices('app', { ids: [2, 3] });
  assert.equal(overlap.cachedRecords, 1);
  await client.prices('app', { ids: [2], region: 'us' });
  await client.prices('sub', { ids: [2] });
  now = 300000;
  await client.prices('app', { ids: [2] });
  assert.deepEqual(requests, ['1,2', '3', '2', '2', '2']);
});

test('record quotas cover minute, hour and concurrent calls', async () => {
  let now = 0;
  const client = clientWith(async url => reply(Object.fromEntries(url.searchParams.get('ids').split(',').map(id => [id, null]))), { now: () => now });
  for (let batch = 0; batch < 10; batch++) {
    now = batch * 60000;
    const ids = Array.from({ length: 100 }, (_, i) => 1 + batch * 100 + i);
    const pending = client.prices('app', { ids });
    await assert.rejects(client.prices('sub', { ids: [99999] }), { code: 'RATE_LIMIT' });
    await pending;
  }
  now = 600000;
  await assert.rejects(client.prices('sub', { ids: [99999] }), error => error.code === 'RATE_LIMIT' && error.retryAfterSeconds === 3000);
  now = 3600000;
  await client.prices('sub', { ids: [99999] });
});

test('429 exposes sanitized quota and does not retry automatically', async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls++;
    return new Response('secret-fixture', { status: 429, headers: { 'retry-after': '120', 'x-ratelimit-remaining': '0' } });
  });
  await assert.rejects(client.prices('app', { ids: [1] }), error => error.code === 'RATE_LIMIT' && error.retryAfterSeconds === 120);
  await assert.rejects(client.prices('app', { ids: [1] }), { code: 'RATE_LIMIT' });
  assert.equal(calls, 1);
  assert.equal(client.status().remoteRateLimit.remaining, 0);
});

test('errors never echo credentials, remote bodies, status text or network causes', async () => {
  for (const fetcher of [
    async () => { throw new Error('https://api.gg.deals/?key=secret-fixture'); },
    async () => new Response('secret-fixture', { status: 403, statusText: 'secret-fixture' }),
    async () => new Response('secret-fixture', { status: 500, statusText: 'secret-fixture' }),
    async () => new Response('secret-fixture', { status: 200 }),
    async () => Response.json({ success: false, data: { message: 'secret-fixture' } }),
    async () => reply({}),
    async () => reply({ 1: { ...game, prices: { ...game.prices, currentRetail: 'secret-fixture' } } }),
  ]) {
    await assert.rejects(clientWith(fetcher).prices('app', { ids: [1] }), error => {
      assert.ok(!String(error).includes('secret-fixture'));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
