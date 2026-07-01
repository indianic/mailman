import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { resolveProviderOrError, mapProviderError } from './mail-helpers.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  account: z.string().optional(),
  id: z.string(),
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
    const email = await resolved.provider.read(parsed.data.id);
    return toolResponse(email);
  } catch (err) {
    return mapProviderError(err);
  }
}

export const readEmailTool: Tool = {
  definition: {
    name: 'read_email',
    description:
      'Read the full content of one email. id comes from a prior list_recent_emails or search_emails call. Attachment entries are metadata only — this tool does not download attachment bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  handler,
};
