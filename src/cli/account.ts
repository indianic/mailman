import { intro, outro, text, password, select, confirm, isCancel, cancel } from '@clack/prompts';
import {
  configureAccount,
  listAccounts,
  removeAccount,
  resolveAccount,
  updateAccountProfile,
  getDefaultAlias,
  AccountResolutionError,
  AccountRemovalConfirmationError,
} from '../accounts.js';
import { updateSettings } from '../settings.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import { authorizeOAuth2Account } from './auth-login.js';
import { promptProfileDetails } from './prompt-profile.js';
import { promptAndWriteEditorConfigs } from './register-editors.js';
import { isInteractiveTerminal, requireTty } from './interactive.js';
import { section, detail, fail } from './tree.js';

interface AppPasswordDetails {
  alias: string;
  email: string;
  pass: string;
  displayName?: string;
  signature?: string;
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

  const { displayName, signature } = await promptProfileDetails();

  return { alias: String(alias), email: String(email), pass: String(pass), displayName, signature };
}

async function addAppPasswordAccount(details: AppPasswordDetails, setDefault?: boolean) {
  try {
    return await configureAccount({
      alias: details.alias,
      email: details.email,
      method: 'app-password',
      credentials: { user: details.email, pass: details.pass },
      setDefault,
      displayName: details.displayName,
      signature: details.signature,
    });
  } catch (err) {
    if (err instanceof KeyringUnavailableError) {
      fail(err.message);
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

/** `mailman init` — first-run wizard; thin wrapper over the same account-creation paths `configure_account`/`auth login` use, then auto-writes each selected editor's MCP config. */
export async function runInit(_args: string[]): Promise<void> {
  intro('mailman — first-run setup');
  requireTty('`mailman init`');
  const { account, isDefault } = await addAccountInteractive();

  // Auto-write editor configs, ContextBrain-style — the account alone doesn't
  // make Claude/Cursor/etc. aware of mailman; this is the step that does.
  const written = await promptAndWriteEditorConfigs();

  if (written.length > 0) {
    outro(
      `Added "${account.alias}"${isDefault ? ' (default)' : ''} and registered it with ${written.length} tool(s). ` +
        'Restart the tool so it loads mailman, then try "mailman, send ..." there.',
    );
  } else {
    outro(
      `Added "${account.alias}"${isDefault ? ' (default)' : ''}. To register it later, run ` +
        '`mailman register --tools claude` (or `claude mcp add mailman -- npx -y @indianic/mailman`).',
    );
  }
}

/** `mailman account add [--default]` — same underlying paths as `init`, for adding additional accounts. */
export async function runAccountAdd(args: string[]): Promise<void> {
  intro('mailman — add account');
  requireTty('`mailman account add`');
  const { account, isDefault } = await addAccountInteractive(args.includes('--default'));
  outro(`Added "${account.alias}"${isDefault ? ' (default)' : ''}.`);
}

/** `mailman account list` — accounts (alias, method, default, read-access). */
export async function runAccountList(_args: string[]): Promise<void> {
  intro('mailman — accounts');
  const [accounts, defaultAlias] = await Promise.all([listAccounts(), getDefaultAlias()]);
  if (accounts.length === 0) {
    outro('No accounts configured — run `mailman init`.');
    return;
  }

  section('accounts');
  for (const a of accounts) {
    const flags = [
      a.method,
      a.alias === defaultAlias ? 'default' : null,
      'read: yes',
      a.displayName ? `from: "${a.displayName}"` : null,
    ]
      .filter(Boolean)
      .join('   ');
    detail(`${a.alias}   ${a.email}   ${flags}`);
  }
  outro(`${accounts.length} account(s)`);
}

/** `mailman account remove <alias> [--yes]` — mirrors remove_account's confirmRemoval gate. */
export async function runAccountRemove(args: string[]): Promise<void> {
  const alias = args.find((a) => !a.startsWith('--'));
  const yes = args.includes('--yes');

  intro('mailman — remove account');

  if (!alias) {
    fail('Usage: mailman account remove <alias> [--yes]');
    process.exit(1);
  }

  try {
    await removeAccount(alias, yes);
    outro(`Removed "${alias}".`);
  } catch (err) {
    if (err instanceof AccountRemovalConfirmationError) {
      if (!isInteractiveTerminal()) {
        fail(`${err.message.replace(' — pass confirmRemoval: true to remove it anyway.', '')} Re-run with --yes to confirm non-interactively.`);
        process.exit(1);
      }
      const proceed = await confirm({ message: `${err.message.replace(' — pass confirmRemoval: true to remove it anyway.', '')} Remove anyway?` });
      if (isCancel(proceed) || !proceed) {
        cancel('Cancelled — no changes made.');
        return;
      }
      await removeAccount(alias, true);
      outro(`Removed "${alias}".`);
      return;
    }
    if (err instanceof AccountResolutionError) {
      fail(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** `mailman account set-default <alias>` */
export async function runAccountSetDefault(args: string[]): Promise<void> {
  const alias = args[0];

  intro('mailman — set default account');

  if (!alias) {
    fail('Usage: mailman account set-default <alias>');
    process.exit(1);
  }

  const accounts = await listAccounts();
  if (!accounts.some((a) => a.alias === alias)) {
    fail(`No configured account with alias "${alias}"`);
    process.exit(1);
  }

  await updateSettings((current) => ({ ...current, defaultAccount: alias }));
  outro(`"${alias}" is now the default account.`);
}

function renderProfile(account: { alias: string; email: string; displayName?: string; signature?: string }): void {
  section(`profile — ${account.alias} (${account.email})`);
  detail(`from name   ${account.displayName ?? '(not set — recipients see the bare address)'}`);
  // Multi-line signatures render with the rail unbroken (tree.ts handles \n continuation).
  detail(`signature   ${account.signature ?? '(not set)'}`);
}

/**
 * `mailman account profile [alias] [--name "..."] [--signature "..."]
 *  [--clear-name] [--clear-signature]`
 *
 * The terminal path to the same displayName/signature fields the
 * `update_account_profile` MCP tool edits — added because a real user went
 * looking for a signature command in `help`/`examples` and found nothing:
 * these fields were previously settable only via the init wizard's prompts
 * or the MCP tool. With no flags, shows the current profile. The alias is
 * optional and resolves like everywhere else (explicit → only account →
 * default). Credentials are never touched.
 */
export async function runAccountProfile(args: string[]): Promise<void> {
  intro('mailman — account profile');

  let alias: string | undefined;
  let displayName: string | null | undefined;
  let signature: string | null | undefined;

  // Only OUR flags disqualify a value — a plain startsWith('--') check
  // rejected a real user's signature of "---------------" (all dashes).
  const KNOWN_FLAGS = ['--name', '--signature', '--clear-name', '--clear-signature'];
  const missingValue = (v: string | undefined) => v === undefined || KNOWN_FLAGS.includes(v);

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name') {
      displayName = args[++i];
      if (missingValue(displayName)) {
        fail('--name requires a value (use --clear-name to remove it)');
        process.exit(1);
      }
    } else if (a === '--signature') {
      signature = args[++i];
      if (missingValue(signature)) {
        fail('--signature requires a value (use --clear-signature to remove it)');
        process.exit(1);
      }
      // Shells pass \n as two literal characters — convert so
      // `--signature "Regards,\nKalpesh"` really produces a two-line
      // signature, as `mailman examples` promises.
      signature = signature!.replace(/\\n/g, '\n');
    } else if (a === '--clear-name') {
      displayName = null;
    } else if (a === '--clear-signature') {
      signature = null;
    } else if (!a.startsWith('--') && alias === undefined) {
      alias = a;
    } else {
      fail(`Unknown argument: ${a}\nUsage: mailman account profile [alias] [--name "..."] [--signature "..."] [--clear-name] [--clear-signature]`);
      process.exit(1);
    }
  }

  let account;
  try {
    account = await resolveAccount(alias);
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      fail(err.message);
      process.exit(1);
    }
    throw err;
  }

  // No flags → just show the current profile.
  if (displayName === undefined && signature === undefined) {
    renderProfile(account);
    outro('Change it: mailman account profile --name "..." --signature "..."');
    return;
  }

  const updated = await updateAccountProfile(account.alias, { displayName, signature });
  renderProfile(updated);
  outro('Profile updated. Applies to the next draft — no restart needed.');
}
