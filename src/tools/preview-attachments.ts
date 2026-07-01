import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { resolveAttachments } from './resolve-attachments.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  attachments: z.array(z.string()),
  recursive: z.boolean().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const result = await resolveAttachments(parsed.data.attachments, { recursive: parsed.data.recursive });
  if ('code' in result) {
    return toolError(result.code, result.message);
  }

  return toolResponse(result);
}

export const previewAttachmentsTool: Tool = {
  definition: {
    name: 'preview_attachments',
    description:
      'Resolve the same path/glob/directory input draft_email would accept and return the file list, without creating a draft or touching any account — a quick "what would this attach?" check.',
    inputSchema: {
      type: 'object',
      properties: {
        attachments: { type: 'array', items: { type: 'string' } },
        recursive: { type: 'boolean', description: 'Expand directories recursively (default: top-level only)' },
      },
      required: ['attachments'],
    },
  },
  handler,
};
