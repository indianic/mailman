import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { listContacts, mergeWithGoogleContacts } from '../contacts.js';
import { resolveAccount } from '../accounts.js';
import { getProvider } from '../mail/get-provider.js';
import { debugLog } from '../logging.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ account: z.string().optional() });

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const local = await listContacts();
  let providerContacts: Array<{ email: string; name?: string }> = [];

  // A missing/ambiguous account or a provider-level failure falls back to
  // local-only results rather than failing the whole call — ImapSmtpProvider
  // always returns [] here anyway (App Password accounts have no Google
  // Contacts access).
  try {
    const account = await resolveAccount(parsed.data.account);
    const provider = await getProvider(account);
    providerContacts = await provider.listContacts();
  } catch (err) {
    debugLog('list_contacts: skipping provider contacts merge', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return toolResponse({ contacts: mergeWithGoogleContacts(local, providerContacts) });
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
