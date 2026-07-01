import { intro, outro, text, password, log, isCancel, cancel } from '@clack/prompts';
import { configureAccount } from '../accounts.js';

interface AccountDetails {
  alias: string;
  email: string;
  pass: string;
}

async function promptAccountDetails(): Promise<AccountDetails> {
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

  log.info('Only the App Password method is available right now — OAuth2 support lands in a later phase.');
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

/** `mcp-mailman init` — thin wrapper over configureAccount(), same function `configure_account` calls. */
export async function runInit(_args: string[]): Promise<void> {
  intro('mailman — first-run setup');
  const details = await promptAccountDetails();
  const account = await configureAccount({
    alias: details.alias,
    email: details.email,
    method: 'app-password',
    credentials: { user: details.email, pass: details.pass },
  });
  outro(
    `Added "${account.alias}"${account.isDefault ? ' (default)' : ''}. Next: run ` +
      '`claude mcp add mailman -- npx -y mcp-mailman` to register it, then try "mailman, send ..." from a Claude session.',
  );
}

/** `mcp-mailman account add [--default]` — same underlying function as `init`, for adding additional accounts. */
export async function runAccountAdd(args: string[]): Promise<void> {
  intro('mailman — add account');
  const details = await promptAccountDetails();
  const account = await configureAccount({
    alias: details.alias,
    email: details.email,
    method: 'app-password',
    credentials: { user: details.email, pass: details.pass },
    setDefault: args.includes('--default'),
  });
  outro(`Added "${account.alias}"${account.isDefault ? ' (default)' : ''}.`);
}
