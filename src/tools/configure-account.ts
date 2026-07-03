import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { configureAccount, DuplicateEmailError } from '../accounts.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import { verifyCredentials } from '../auth/verify.js';
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
    displayName: z.string().optional(),
    signature: z.string().optional(),
    skipVerify: z.boolean().optional(),
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
    displayName: z.string().optional(),
    signature: z.string().optional(),
    skipVerify: z.boolean().optional(),
  }),
]);

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { skipVerify, ...input } = parsed.data;

  // Prove the credentials actually work with Gmail before persisting them —
  // otherwise a wrong App Password / stale refresh token is only discovered
  // on the first (silently failing) send. `skipVerify: true` is the escape
  // hatch for offline setup. IMAP being unreachable is a soft warning, not a
  // failure (sending still works).
  let imapWarning: string | undefined;
  if (!skipVerify) {
    const result =
      input.method === 'app-password'
        ? await verifyCredentials({ method: 'app-password', credentials: input.credentials })
        : await verifyCredentials({ method: 'oauth2', credentials: input.credentials });
    if (!result.ok) {
      return toolError(ErrorCodes.VERIFICATION_FAILED, result.error ?? 'Credential verification failed.');
    }
    imapWarning = result.imapWarning;
  }

  try {
    const { account, isDefault } = await configureAccount(input);
    return toolResponse({ alias: account.alias, isDefault, verified: !skipVerify, ...(imapWarning ? { imapWarning } : {}) });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return toolError(ErrorCodes.DUPLICATE_EMAIL, err.message);
    }
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
      'Add or update a Gmail account. The credentials are verified against Gmail (a live login) BEFORE anything is stored — a wrong App Password or stale OAuth2 refresh token is rejected here with VERIFICATION_FAILED rather than failing silently on the first send. The first account ever added becomes the default automatically. For oauth2, the refresh token must already exist — get one via the `mailman auth login`/`account add` CLI commands, which drive the browser consent flow this tool itself cannot.',
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
        displayName: { type: 'string', description: '"From Name" shown to recipients, e.g. "Kalpesh Gamit"' },
        signature: { type: 'string', description: 'Appended to every draft from this account' },
        skipVerify: {
          type: 'boolean',
          description: 'Skip the live Gmail verification and store the credentials as-is (offline setup only). Default false.',
        },
      },
      required: ['alias', 'email', 'method', 'credentials'],
    },
  },
  handler,
};
