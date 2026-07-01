import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { resolveProviderOrError, mapProviderError } from './mail-helpers.js';
import { clampLimit } from '../mail/normalize.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  account: z.string().optional(),
  folder: z.enum(['inbox', 'sent']).optional(),
  limit: z.number().int().positive().optional(),
  pageToken: z.string().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const resolved = await resolveProviderOrError(parsed.data.account);
  if ('errorResponse' in resolved) {
    return resolved.errorResponse;
  }

  try {
    const page = await resolved.provider.list({
      folder: parsed.data.folder ?? 'inbox',
      limit: clampLimit(parsed.data.limit),
      pageToken: parsed.data.pageToken,
    });
    return toolResponse({ emails: page.items, nextPageToken: page.nextPageToken });
  } catch (err) {
    return mapProviderError(err);
  }
}

export const listRecentEmailsTool: Tool = {
  definition: {
    name: 'list_recent_emails',
    description: 'List the most recent emails in a folder — "last 10 emails," "last 10 sent."',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        folder: { type: 'string', enum: ['inbox', 'sent'], description: 'Defaults to "inbox"' },
        limit: { type: 'number', description: 'Defaults to 10, capped at 50' },
        pageToken: { type: 'string' },
      },
    },
  },
  handler,
};
