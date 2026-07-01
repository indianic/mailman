import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { removeAccount, AccountResolutionError, AccountRemovalConfirmationError } from '../accounts.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  alias: z.string().min(1),
  confirmRemoval: z.boolean().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  try {
    await removeAccount(parsed.data.alias, parsed.data.confirmRemoval);
    return toolResponse({ removed: true });
  } catch (err) {
    if (err instanceof AccountRemovalConfirmationError) {
      return toolError(err.code, err.message);
    }
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }
}

export const removeAccountTool: Tool = {
  definition: {
    name: 'remove_account',
    description:
      'Delete a configured account. Requires confirmRemoval: true when removing the last remaining account or the current default — one ambiguous instruction should never silently leave zero configured accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string' },
        confirmRemoval: { type: 'boolean' },
      },
      required: ['alias'],
    },
  },
  handler,
};
