import { intro, outro, text, password, select, log, isCancel, cancel } from '@clack/prompts';
import { configureAccount } from '../accounts.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import { authorizeOAuth2Account } from './auth-login.js';

interface AppPasswordDetails {
  alias: string;
  email: string;
  pass: string;
}

async function promptMethod(): Promise<'app-password' | 'oauth2'> {
  const method = await select({
    message: 'Auth method',
    options: [
      { value: 'app-password', label: 'App Password (fast — 2-Step Verification + a generated password)' },
      { value: 'oauth2', label: 'OAuth2 (needs a Google Cloud OAuth client — see README)' },
    ],
  });
  if (isCancel(method)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return method as 'app-password' | 'oauth2';
}

async function promptAppPasswordDetails(): Promise<AppPasswordDetails> {
  const alias = await text({
    message: 'Account alias (a short nickname, e.g. "personal-gmail")',
    placeholder: 'personal-gmail',
    validate: (v) => (v.trim().length > 0 ? undefined : 'Alias is required'),
  });
  if (isCancel(alias)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const email = await text({
    message: 'Gmail address',
    validate: (v) => (v.includes('@') ? undefined : 'Enter a valid email address'),
  });
  if (isCancel(email)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const pass = await password({
    message: 'Gmail App Password (16 characters, from https://myaccount.google.com/apppasswords)',
    validate: (v) => (v.trim().length > 0 ? undefined : 'App Password is required'),
  });
  if (isCancel(pass)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  return { alias: String(alias), email: String(email), pass: String(pass) };
}

async function addAppPasswordAccount(details: AppPasswordDetails, setDefault?: boolean) {
  try {
    return await configureAccount({
      alias: details.alias,
      email: details.email,
      method: 'app-password',
      credentials: { user: details.email, pass: details.pass },
      setDefault,
    });
  } catch (err) {
    if (err instanceof KeyringUnavailableError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

async function addAccountInteractive(setDefault?: boolean) {
  const method = await promptMethod();
  if (method === 'app-password') {
    const details = await promptAppPasswordDetails();
    return addAppPasswordAccount(details, setDefault);
  }

  const alias = await text({
    message: 'Account alias (a short nickname, e.g. "work-gmail")',
    placeholder: 'work-gmail',
    validate: (v) => (v.trim().length > 0 ? undefined : 'Alias is required'),
  });
  if (isCancel(alias)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const email = await text({
    message: 'Gmail address',
    validate: (v) => (v.includes('@') ? undefined : 'Enter a valid email address'),
  });
  if (isCancel(email)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return authorizeOAuth2Account({ alias: String(alias), email: String(email), setDefault });
}

/** `mcp-mailman init` — first-run wizard; thin wrapper over the same account-creation paths `configure_account`/`auth login` use. */
export async function runInit(_args: string[]): Promise<void> {
  intro('mailman — first-run setup');
  const account = await addAccountInteractive();
  outro(
    `Added "${account.alias}"${account.isDefault ? ' (default)' : ''}. Next: run ` +
      '`claude mcp add mailman -- npx -y mcp-mailman` to register it, then try "mailman, send ..." from a Claude session.',
  );
}

/** `mcp-mailman account add [--default]` — same underlying paths as `init`, for adding additional accounts. */
export async function runAccountAdd(args: string[]): Promise<void> {
  intro('mailman — add account');
  const account = await addAccountInteractive(args.includes('--default'));
  outro(`Added "${account.alias}"${account.isDefault ? ' (default)' : ''}.`);
}
