#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { toolError } from './response.js';
import { allTools } from './tools/index.js';

const server = new Server({ name: 'mcp-mailman', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => t.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const tool = allTools.find((t) => t.definition.name === req.params.name);
  if (!tool) {
    return toolError('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`) as CallToolResult;
  }
  try {
    const args = (req.params.arguments as Record<string, unknown>) ?? {};
    return (await tool.handler(args)) as CallToolResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError('INTERNAL_ERROR', message) as CallToolResult;
  }
});

// The MCP server is a stdio process the Claude CLI owns and can terminate
// at any time. Exit cleanly and promptly on shutdown signals — never try
// to finish an in-flight send afterward; better to fail the call and let
// Claude retry. Phase 3 adds a pending activity.log flush here; Phase 7
// adds closing an open IMAP session.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    process.stderr.write(`[mcp-mailman] received ${signal}, shutting down\n`);
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
process.stderr.write(`[mcp-mailman] connected — ${allTools.length} tools available\n`);
