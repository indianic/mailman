import { intro, outro, log, text, password, isCancel, cancel } from '@clack/prompts';
import { configureAccount } from '../accounts.js';
import { runOAuthLogin, type OAuthClientConfig } from '../auth/oauth2-login.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import type { Account } from '../config/schema.js';

async function promptClientCredentials(): Promise<OAuthClientConfig> {
  log.info(
    'Needs a Google Cloud OAuth client ("Desktop app" type) — see the README for setup steps if you ' +
      "haven't created one yet.",
  );
  log.warn(
    'This grants full-mailbox read access (gmail.readonly), not just send — mailman will be able to ' +
      'list, search, and read your inbox and sent mail, not only send new messages.',
  );
  const clientId = await text({ message: 'OAuth Client ID' });
  if (isCancel(clientId)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const clientSecret = await password({ message: 'OAuth Client Secret' });
  if (isCancel(clientSecret)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return { clientId: String(clientId), clientSecret: String(clientSecret) };
}

export interface AuthorizeOAuth2AccountOptions {
  alias: string;
  email: string;
  setDefault?: boolean;
  noBrowser?: boolean;
}

/**
 * Shared by `auth login` and `account add` (when oauth2 is chosen) — one
 * browser-consent-to-stored-account function, two entry points, same
 * split as configureAccount() for App Password accounts.
 */
export async function authorizeOAuth2Account(
  opts: AuthorizeOAuth2AccountOptions,
): Promise<{ account: Account; isDefault: boolean }> {
  const client = await promptClientCredentials();

  log.info('Opening the consent screen...');
  const { refreshToken } = await runOAuthLogin(client, {
    noBrowser: opts.noBrowser,
    onInstructions: (message) => log.info(message),
  });

  try {
    return await configureAccount({
      alias: opts.alias,
      email: opts.email,
      method: 'oauth2',
      credentials: { clientId: client.clientId, clientSecret: client.clientSecret, refreshToken },
      setDefault: opts.setDefault,
    });
  } catch (err) {
    if (err instanceof KeyringUnavailableError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** `mcp-mailman auth login <alias> [--no-browser]` */
export async function runAuthLogin(args: string[]): Promise<void> {
  const alias = args.find((a) => !a.startsWith('--'));
  const noBrowser = args.includes('--no-browser');

  intro('mailman — OAuth2 login');
  if (!alias) {
    log.error('Usage: mcp-mailman auth login <alias> [--no-browser]');
    process.exit(1);
  }

  const email = await text({
    message: 'Gmail address for this account',
    validate: (v) => (v.includes('@') ? undefined : 'Enter a valid email address'),
  });
  if (isCancel(email)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const { account, isDefault } = await authorizeOAuth2Account({ alias, email: String(email), noBrowser });
  outro(`Authorized "${account.alias}"${isDefault ? ' (default)' : ''} via OAuth2.`);
}
