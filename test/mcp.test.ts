import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { DealsClient } from '../src/client.js';

test('stdio initializes from another directory without credentials and discovers tools', { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../../dist/index.js', import.meta.url))], cwd: tmpdir(),
    env: { GG_DEALS_API_KEY: '', GG_DEALS_REGION: 'fr' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.ok(client.getInstructions()?.includes('Read-only'));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    assert.ok(tools.every(tool => tool.annotations?.readOnlyHint));
    const status = await client.callTool({ name: 'gg_deals_status', arguments: {} });
    assert.equal(z.object({ configured: z.boolean() }).parse(status.structuredContent).configured, false);
    const prices = await client.callTool({ name: 'gg_deals_prices_by_steam_app_id', arguments: { ids: [420] } });
    assert.equal(prices.isError, true);
    assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(prices.structuredContent).error.code, 'MISSING_API_KEY');
  } finally { await client.close(); }
  assert.equal(stderr, '');
});

test('MCP tool calls return structured prices and reject invalid input without a request', async () => {
  let calls = 0;
  const server = createServer(new DealsClient({ apiKey: 'fixture', fetchImpl: async () => {
    calls++;
    return Response.json({ success: true, data: { 420: null } });
  } }));
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    for (const kind of ['app', 'sub', 'bundle']) {
      const result = await client.callTool({ name: `gg_deals_prices_by_steam_${kind}_id`, arguments: { ids: [420], region: 'gb' } });
      assert.equal(result.isError, undefined);
      const content = z.object({ data: z.record(z.string(), z.null()), region: z.string() }).parse(result.structuredContent);
      assert.deepEqual(content.data, { 420: null });
      assert.equal(content.region, 'gb');
    }
    const bad = await client.callTool({ name: 'gg_deals_prices_by_steam_app_id', arguments: { ids: [0] } });
    assert.equal(bad.isError, true);
    assert.equal(calls, 3);
  } finally { await client.close(); await server.close(); }
});

