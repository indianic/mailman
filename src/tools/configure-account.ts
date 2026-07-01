import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { configureAccount } from '../accounts.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import type { Tool } from './types.js';

const InputSchema = z.discriminatedUnion('method', [
  z.object({
    alias: z.string().min(1),
    email: z.string().email(),
    method: z.literal('app-password'),
    credentials: z.object({
      user: z.string().email(),
      pass: z.string().min(1),
    }),
    setDefault: z.boolean().optional(),
  }),
  z.object({
    alias: z.string().min(1),
    email: z.string().email(),
    method: z.literal('oauth2'),
    credentials: z.object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      refreshToken: z.string().min(1),
    }),
    setDefault: z.boolean().optional(),
  }),
]);

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  try {
    const { account, isDefault } = await configureAccount(parsed.data);
    return toolResponse({ alias: account.alias, isDefault });
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
    description:
      'Add or update a Gmail account. The first account ever added becomes the default automatically. For oauth2, the refresh token must already exist — get one via the `mcp-mailman auth login`/`account add` CLI commands, which drive the browser consent flow this tool itself cannot.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string' },
        email: { type: 'string' },
        method: { type: 'string', enum: ['app-password', 'oauth2'] },
        credentials: {
          type: 'object',
          description:
            'For app-password: { user, pass }. For oauth2: { clientId, clientSecret, refreshToken }.',
        },
        setDefault: { type: 'boolean' },
      },
      required: ['alias', 'email', 'method', 'credentials'],
    },
  },
  handler,
};
