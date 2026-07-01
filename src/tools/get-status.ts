import { toolResponse } from '../response.js';
import { collectStatus } from '../status.js';
import type { Tool } from './types.js';

async function handler() {
  const status = await collectStatus();
  return toolResponse({
    accounts: status.accounts,
    security: status.security,
    activity: status.activity,
  });
}

export const getStatusTool: Tool = {
  definition: {
    name: 'get_status',
    description:
      'Return the same structured data the `mcp-mailman status` CLI command renders as a tree — accounts, security state, and recent activity counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  handler,
};
