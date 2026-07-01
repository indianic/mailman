import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { configureAccount } from '../accounts.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import type { Tool } from './types.js';

// oauth2 is added in Phase 4 — for now this only accepts app-password,
// with a clear validation error rather than silently mishandling it.
const InputSchema = z.object({
  alias: z.string().min(1),
  email: z.string().email(),
  method: z.literal('app-password'),
  credentials: z.object({
    user: z.string().email(),
    pass: z.string().min(1),
  }),
  setDefault: z.boolean().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  try {
    const account = await configureAccount(parsed.data);
    return toolResponse({ alias: account.alias, isDefault: account.isDefault });
  } catch (err) {
    if (err instanceof KeyringUnavailableError) {
      return toolError(ErrorCodes.NO_MASTER_KEY, err.message);
    }
    throw err;
  }
}

export const configureAccountTool: Tool = {
  definition: {
    name: 'configure_account',
    description: 'Add or update a Gmail account. The first account ever added becomes the default automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string' },
        email: { type: 'string' },
        method: { type: 'string', enum: ['app-password'] },
        credentials: {
          type: 'object',
          properties: {
            user: { type: 'string' },
            pass: { type: 'string', description: 'Gmail App Password (16 characters)' },
          },
          required: ['user', 'pass'],
        },
        setDefault: { type: 'boolean' },
      },
      required: ['alias', 'email', 'method', 'credentials'],
    },
  },
  handler,
};
