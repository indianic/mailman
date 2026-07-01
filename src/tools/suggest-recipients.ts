import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { listContacts, mergeWithGoogleContacts, type SuggestionEntry } from '../contacts.js';
import { resolveAccount, getDecryptedCredentials } from '../accounts.js';
import { fetchGoogleContacts } from '../mail/google-contacts.js';
import type { OAuth2Credentials } from '../auth/oauth2.js';
import { debugLog } from '../logging.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  query: z.string(),
  account: z.string().optional(),
});

function matchScore(entry: { email: string; name?: string }, query: string): number {
  const email = entry.email.toLowerCase();
  const name = entry.name?.toLowerCase() ?? '';
  if (email.startsWith(query) || name.startsWith(query)) {
    return 2;
  }
  if (email.includes(query) || name.includes(query)) {
    return 1;
  }
  return 0;
}

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { query } = parsed.data;

  const local = await listContacts();
  let googleContacts: Array<{ email: string; name?: string }> = [];

  // App Password accounts never have Google Contacts access; a missing/
  // ambiguous account or a People API failure just means no google-
  // contacts results this time, not a hard failure of the whole call.
  try {
    const account = await resolveAccount(parsed.data.account);
    if (account.method === 'oauth2') {
      const credentials = (await getDecryptedCredentials(account)) as OAuth2Credentials;
      googleContacts = await fetchGoogleContacts(credentials);
    }
  } catch (err) {
    debugLog('suggest_recipients: skipping google-contacts merge', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const suggestions: SuggestionEntry[] = mergeWithGoogleContacts(local, googleContacts, query);

  const output: { suggestions: SuggestionEntry[]; next_steps?: string[] } = { suggestions };
  const q = query.trim().toLowerCase();
  const topScore = suggestions.length > 0 ? matchScore(suggestions[0], q) : 0;
  const tiedAtTop = suggestions.filter((s) => matchScore(s, q) === topScore).length;
  if (tiedAtTop >= 2) {
    output.next_steps = [
      'Multiple similarly-ranked candidates matched — ask the user which one before calling draft_email rather than picking one silently.',
    ];
  }

  return toolResponse(output);
}

export const suggestRecipientsTool: Tool = {
  definition: {
    name: 'suggest_recipients',
    description: 'Ranked recipient candidates for a partial name/email.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        account: { type: 'string' },
      },
      required: ['query'],
    },
  },
  handler,
};
