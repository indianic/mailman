import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { listContacts, mergeWithGoogleContacts } from '../contacts.js';
import { resolveAccount, getDecryptedCredentials } from '../accounts.js';
import { fetchGoogleContacts } from '../mail/google-contacts.js';
import type { OAuth2Credentials } from '../auth/oauth2.js';
import { debugLog } from '../logging.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ account: z.string().optional() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const local = await listContacts();
  let googleContacts: Array<{ email: string; name?: string }> = [];

  // A missing/ambiguous account or a People API failure falls back to
  // local-only results rather than failing the whole call — App Password
  // accounts never have Google Contacts access anyway.
  try {
    const account = await resolveAccount(parsed.data.account);
    if (account.method === 'oauth2') {
      const credentials = (await getDecryptedCredentials(account)) as OAuth2Credentials;
      googleContacts = await fetchGoogleContacts(credentials);
    }
  } catch (err) {
    debugLog('list_contacts: skipping google-contacts merge', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return toolResponse({ contacts: mergeWithGoogleContacts(local, googleContacts) });
}

export const listContactsTool: Tool = {
  definition: {
    name: 'list_contacts',
    description:
      'Return the full local address book (no query filter), merged with Google Contacts for OAuth2 accounts — the "get my contacts" case.',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' } },
    },
  },
  handler,
};
