#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { toolError } from './response.js';

const server = new Server({ name: 'mcp-mailman', version: '0.1.0' }, { capabilities: { tools: {} } });

// No tools registered yet — Phase 1+ adds draft_email, confirm_send, etc.
// This skeleton exists to confirm `claude mcp add` wiring works end-to-end.
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  return toolError('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`) as CallToolResult;
});

await server.connect(new StdioServerTransport());
process.stderr.write('[mcp-mailman] connected — 0 tools available\n');
