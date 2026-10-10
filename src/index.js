#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

try {
  await createServer().connect(new StdioServerTransport());
} catch {
  console.error('Unable to start gg-deals-mcp. Check the local installation.');
  process.exitCode = 1;
}
