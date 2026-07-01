import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { cancelDraft } from '../drafts.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ draftId: z.string() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const draft = cancelDraft(parsed.data.draftId);
  if (!draft) {
    return toolError(ErrorCodes.DRAFT_NOT_FOUND, `No such draft: ${parsed.data.draftId}`);
  }

  return toolResponse({ cancelled: true });
}

export const cancelDraftTool: Tool = {
  definition: {
    name: 'cancel_draft',
    description: 'Discard a pending draft without sending.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
      },
      required: ['draftId'],
    },
  },
  handler,
};
