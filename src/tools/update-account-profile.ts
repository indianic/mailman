import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { updateAccountProfile, AccountResolutionError } from '../accounts.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  alias: z.string().min(1),
  displayName: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { alias, displayName, signature } = parsed.data;

  try {
    const account = await updateAccountProfile(alias, { displayName, signature });
    return toolResponse({ alias: account.alias, displayName: account.displayName, signature: account.signature });
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }
}

export const updateAccountProfileTool: Tool = {
  definition: {
    name: 'update_account_profile',
    description:
      'Update an existing account\'s "From Name" and/or signature without touching its credentials. Pass null to clear a field, omit to leave it unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string' },
        displayName: { type: ['string', 'null'], description: '"From Name" shown to recipients, e.g. "Kalpesh Gamit"' },
        signature: { type: ['string', 'null'], description: 'Appended to every draft from this account' },
      },
      required: ['alias'],
    },
  },
  handler,
};
