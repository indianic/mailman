import { intro, outro, text, password, isCancel, cancel } from '@clack/prompts';
import { configureAccount, findAccountByEmail, DuplicateEmailError } from '../accounts.js';
import { runOAuthLogin, type OAuthClientConfig } from '../auth/oauth2-login.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import { promptProfileDetails } from './prompt-profile.js';
import { requireTty } from './interactive.js';
import { fail, info, attention, detail } from './tree.js';
import type { Account } from '../config/schema.js';

/**
 * Full, click-by-click walkthrough for creating the Google OAuth client —
 * printed inline before the Client ID/Secret prompts. Most users have never
 * opened Google Cloud Console and have no idea where these values come from,
 * so we show every step with its exact URL rather than pointing at the README.
 */
function printOAuthClientSetupGuide(): void {
  info("Don't have a Client ID / Secret yet? Create a Google OAuth client — one-time, ~2 minutes:");
  detail(
    '1. Create or pick a Google Cloud project\n' +
      '     → https://console.cloud.google.com/projectcreate\n' +
      '2. Enable the Gmail API for that project, then click "Enable"\n' +
      '     → https://console.cloud.google.com/apis/library/gmail.googleapis.com\n' +
      '3. Set up the OAuth consent screen\n' +
      '     → https://console.cloud.google.com/apis/credentials/consent\n' +
      '     • User type: External  → add an app name + your email  → Save\n' +
      '     • Under "Test users", add your own Gmail (avoids Google app verification)\n' +
      '4. Create the client\n' +
      '     → https://console.cloud.google.com/apis/credentials\n' +
      '     • Create credentials → OAuth client ID → Application type: Desktop app → Create\n' +
      '5. A popup shows your Client ID and Client secret — copy both and paste them below',
  );
  attention(
    'Step 4 MUST be "Desktop app", NOT "Web application" — a Web-app client fails with ' +
      '"Error 400: redirect_uri_mismatch" (mailman uses a loopback redirect that only Desktop apps allow).',
  );
  attention(
    'This grants full-mailbox read access (gmail.readonly), not just send — mailman will be able to ' +
      'list, search, and read your inbox and sent mail, not only send new messages.',
  );
}

async function promptClientCredentials(): Promise<OAuthClientConfig> {
  printOAuthClientSetupGuide();
  // Both fields are required. Without a validate, @clack's text() returns
  // `undefined` on an empty submit — which `String()` turned into the literal
  // "undefined" (and a blank placeholder rendered as "undefined" too), so an
  // empty Client ID/Secret sailed straight through to a doomed consent call.
  const clientId = await text({
    message: 'OAuth Client ID',
    placeholder: 'xxxxxxxx.apps.googleusercontent.com',
    validate: (v) => (v && v.trim().length > 0 ? undefined : 'Client ID is required'),
  });
  if (isCancel(clientId)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const clientSecret = await password({
    message: 'OAuth Client Secret',
    validate: (v) => (v && v.trim().length > 0 ? undefined : 'Client Secret is required'),
  });
  if (isCancel(clientSecret)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() };
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

  info('Opening the consent screen in your browser — approve there, then come back.');
  attention(
    'If the browser shows "Error 400: redirect_uri_mismatch", your OAuth client is a "Web application" ' +
      '— recreate it as "Desktop app" and run this again. (Waiting up to 5 minutes for approval.)',
  );
  const { refreshToken } = await runOAuthLogin(client, {
    noBrowser: opts.noBrowser,
    onInstructions: (message) => info(message),
  });
  const { displayName, signature } = await promptProfileDetails();

  try {
    return await configureAccount({
      alias: opts.alias,
      email: opts.email,
      method: 'oauth2',
      credentials: { clientId: client.clientId, clientSecret: client.clientSecret, refreshToken },
      setDefault: opts.setDefault,
      displayName,
      signature,
    });
  } catch (err) {
    if (err instanceof DuplicateEmailError || err instanceof KeyringUnavailableError) {
      fail(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** `mailman auth login <alias> [--no-browser]` */
export async function runAuthLogin(args: string[]): Promise<void> {
  const alias = args.find((a) => !a.startsWith('--'));
  const noBrowser = args.includes('--no-browser');

  intro('mailman — OAuth2 login');
  requireTty('`mailman auth login`');
  if (!alias) {
    fail('Usage: mailman auth login <alias> [--no-browser]');
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
  const address = String(email).trim();

  // One email = one account (ignoring this alias, so re-authing an existing
  // account is fine) — check before the browser consent dance.
  const dupe = await findAccountByEmail(address, alias);
  if (dupe) {
    fail(
      `${address} is already added as "${dupe.alias}". Each email can be added once — ` +
        `remove it first (\`mailman account remove ${dupe.alias}\`) or re-run with alias "${dupe.alias}" to re-authorize it.`,
    );
    process.exit(1);
  }

  const { account, isDefault } = await authorizeOAuth2Account({ alias, email: address, noBrowser });
  outro(`Authorized "${account.alias}"${isDefault ? ' (default)' : ''} via OAuth2.`);
}
