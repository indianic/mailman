import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { listScheduled, decryptContent } from '../scheduler/store.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ account: z.string().optional() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const entries = await listScheduled();
  const filtered = parsed.data.account ? entries.filter((e) => e.account === parsed.data.account) : entries;

  const scheduled = await Promise.all(
    filtered.map(async (e) => {
      const content = await decryptContent(e);
      return {
        scheduledId: e.scheduledId,
        to: content.to,
        subject: content.subject,
        sendAt: e.sendAt,
        status: e.status,
        attempts: e.attempts,
      };
    }),
  );

  return toolResponse({ scheduled });
}

export const listScheduledTool: Tool = {
  definition: {
    name: 'list_scheduled',
    description: 'List pending (and recently resolved) scheduled sends.',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' } },
    },
  },
  handler,
};
