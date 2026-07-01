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
import { appendActivity, extractAuditMetadata } from './audit.js';
import { debugLog } from './logging.js';

const server = new Server({ name: 'mcp-mailman', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => t.definition),
}));

// Tracked so the shutdown handler below can wait for the in-flight audit
// write instead of exiting mid-append.
let lastAuditWrite: Promise<unknown> = Promise.resolve();

function recordActivity(toolName: string, args: Record<string, unknown>, ok: boolean): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    account: typeof args.account === 'string' ? args.account : undefined,
    ok,
    metadata: extractAuditMetadata(args),
  };
  const write = appendActivity(entry).catch((err) => {
    debugLog('audit log write failed', { message: err instanceof Error ? err.message : String(err) });
  });
  lastAuditWrite = write;
  return write;
}

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const tool = allTools.find((t) => t.definition.name === req.params.name);
  if (!tool) {
    return toolError('UNKNOWN_TOOL', `Unknown tool: ${req.params.name}`) as CallToolResult;
  }

  const args = (req.params.arguments as Record<string, unknown>) ?? {};
  try {
    const result = await tool.handler(args);
    await recordActivity(req.params.name, args, !result.isError);
    return result as CallToolResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog(`tool call threw: ${req.params.name}`, { args });
    await recordActivity(req.params.name, args, false);
    return toolError('INTERNAL_ERROR', message) as CallToolResult;
  }
});

// The MCP server is a stdio process the Claude CLI owns and can terminate
// at any time. On a shutdown signal: flush the in-flight activity.log
// write (bounded by a short timeout, in case the filesystem is stuck),
// then exit — never attempt to finish an in-flight send afterward; better
// to fail the call cleanly and let Claude retry. Phase 7 adds closing an
// open IMAP session here too.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    process.stderr.write(`[mcp-mailman] received ${signal}, shutting down\n`);
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    Promise.race([lastAuditWrite.catch(() => undefined), timeout]).then(() => process.exit(0));
  });
}

await server.connect(new StdioServerTransport());
process.stderr.write(`[mcp-mailman] connected — ${allTools.length} tools available\n`);
