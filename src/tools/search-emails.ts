import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { resolveProviderOrError, mapProviderError } from './mail-helpers.js';
import { clampLimit } from '../mail/normalize.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  account: z.string().optional(),
  query: z.string(),
  folder: z.enum(['inbox', 'sent', 'all']).optional(),
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
    const page = await resolved.provider.search({
      query: parsed.data.query,
      folder: parsed.data.folder ?? 'inbox',
      limit: clampLimit(parsed.data.limit),
      pageToken: parsed.data.pageToken,
    });
    return toolResponse({ emails: page.items, nextPageToken: page.nextPageToken });
  } catch (err) {
    return mapProviderError(err);
  }
}

export const searchEmailsTool: Tool = {
  definition: {
    name: 'search_emails',
    description:
      'Search a folder (or all mail) by query. oauth2 accounts get Gmail\'s native query syntax passed through verbatim (from:, subject:, after:, has:attachment, ...). app-password accounts get a simplified subset (subject/from/date-range) since IMAP SEARCH is less expressive.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        query: { type: 'string' },
        folder: { type: 'string', enum: ['inbox', 'sent', 'all'], description: 'Defaults to "inbox"' },
        limit: { type: 'number', description: 'Defaults to 10, capped at 50' },
        pageToken: { type: 'string' },
      },
      required: ['query'],
    },
  },
  handler,
};
