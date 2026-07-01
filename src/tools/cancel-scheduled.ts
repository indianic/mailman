import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { cancelScheduledEntry } from '../scheduler/store.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ scheduledId: z.string() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const cancelled = await cancelScheduledEntry(parsed.data.scheduledId);
  if (!cancelled) {
    return toolError(ErrorCodes.SCHEDULE_NOT_FOUND, `No pending scheduled send with id "${parsed.data.scheduledId}"`);
  }

  return toolResponse({ cancelled: true });
}

export const cancelScheduledTool: Tool = {
  definition: {
    name: 'cancel_scheduled',
    description: 'Cancel a pending scheduled send before it fires.',
    inputSchema: {
      type: 'object',
      properties: { scheduledId: { type: 'string' } },
      required: ['scheduledId'],
    },
  },
  handler,
};
