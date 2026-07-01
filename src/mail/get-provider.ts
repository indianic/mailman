import { getDecryptedCredentials } from '../accounts.js';
import type { Account } from '../config/schema.js';
import type { AppPasswordCredentials } from '../auth/app-password.js';
import type { OAuth2Credentials } from '../auth/oauth2.js';
import { GmailApiProvider } from './gmail-api-client.js';
import { ImapSmtpProvider } from './imap-client.js';
import type { MailProvider } from './provider.js';

/**
 * The one place tools branch on auth method — everywhere else just calls
 * the returned MailProvider. See docs/PLAN.md's "Provider abstraction"
 * section: this is what makes IMAP's simplified search a one-line fact
 * inside ImapSmtpProvider, not something every tool re-checks.
 */
export async function getProvider(account: Account): Promise<MailProvider> {
  const credentials = await getDecryptedCredentials(account);
  if (account.method === 'oauth2') {
    return new GmailApiProvider(credentials as OAuth2Credentials, account.email);
  }
  return new ImapSmtpProvider(credentials as AppPasswordCredentials);
}
