import { toolResponse } from '../response.js';
import { listAccounts, getDefaultAlias } from '../accounts.js';
import type { Tool } from './types.js';

async function handler() {
  const [accounts, defaultAlias] = await Promise.all([listAccounts(), getDefaultAlias()]);
  return toolResponse({
    accounts: accounts.map((a) => ({
      alias: a.alias,
      email: a.email,
      method: a.method,
      isDefault: a.alias === defaultAlias,
      // Always true today — scope requests are all-or-nothing at consent
      // and App Password accounts get IMAP implicitly. The field exists
      // for a future case where read access isn't guaranteed either way.
      canRead: true,
    })),
  });
}

export const listAccountsTool: Tool = {
  definition: {
    name: 'list_accounts',
    description: 'List configured sender aliases (no secrets returned).',
    inputSchema: { type: 'object', properties: {} },
  },
  handler,
};
