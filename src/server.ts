import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DealsClient, DealsError, inputSchema } from './client.js';
import { z } from 'zod';

export function createServer(client = new DealsClient()) {
  const server = new McpServer({ name: 'gg-deals-mcp', version: '1.0.0' }, {
    instructions: 'Read-only GG.deals price tools. Use the correct Steam app, sub or bundle IDs. Keep official stores and keyshops distinct. Prices are decimal strings in the returned currency, not guaranteed purchase offers. Null means unavailable or unknown, never free. Data can be cached for five minutes. No title search or individual shop listing is provided by this API. Never request API keys in chat.',
  });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const result = (value: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  server.registerTool('gg_deals_status', {
    description: 'Show local configuration, supported regions and last observed quota. Does not validate the API key or call the network.',
    inputSchema: {}, annotations: { ...annotations, openWorldHint: false },
  }, async () => result(client.status()));
  for (const [kind, label] of [['app', 'games'], ['sub', 'packages'], ['bundle', 'bundles']]) {
    server.registerTool(`gg_deals_prices_by_steam_${kind}_id`, {
      description: `Get current and historical lowest prices for Steam ${label} by ${kind} IDs. Up to 100 IDs; official retail and keyshop prices are separate. A null item is unknown; a null price is unavailable.`,
      inputSchema: { ...inputSchema, detail: z.enum(['compact', 'detailed']).default('compact') }, annotations,
    }, async args => {
      try {
        const value = await client.prices(kind, args);
        // Preserve all prices, currencies, missing values and per-ID freshness.
        if (args.detail === 'compact') {
          const { rateLimit: _rateLimit, ...compact } = value;
          return result(compact);
        }
        return result(value);
      }
      catch (error) {
        const safe = error instanceof DealsError ? { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds }
          : { code: 'INTERNAL_ERROR', message: 'Unable to retrieve GG.deals prices.' };
        return { ...result({ error: safe }), isError: true };
      }
    });
  }
  return server;
}
