import { intro, outro, text, password, confirm, select, isCancel, cancel, spinner, log } from '@clack/prompts';
import {
  configureAccount,
  listAccounts,
  removeAccount,
  resolveAccount,
  updateAccountProfile,
  getDefaultAlias,
  findAccountByEmail,
  AccountResolutionError,
  AccountRemovalConfirmationError,
  DuplicateEmailError,
} from '../accounts.js';
import { updateSettings } from '../settings.js';
import { KeyringUnavailableError } from '../config/keychain.js';
import { verifyAppPasswordCredentials } from '../auth/verify.js';
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

/** Shared by both auth methods — a short local nickname for the account. */
async function promptAlias(): Promise<string> {
  const alias = await text({
    message: 'Account alias (a short nickname, e.g. "personal-gmail")',
    placeholder: 'personal-gmail',
    validate: (v) => (v.trim().length > 0 ? undefined : 'Alias is required'),
  });
  if (isCancel(alias)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return String(alias);
}

async function promptAppPasswordDetails(): Promise<AppPasswordDetails> {
  const alias = await promptAlias();

  // Ask for the address + App Password and actually log in to Gmail before
  // moving on. A wrong App Password is the #1 setup mistake (and silently
  // breaks every later send), so we verify the pair — but a failed verify is
  // NEVER a dead end: after each rejection the user chooses retry / save-
  // anyway / cancel. "Save anyway" matters because Google temporarily blocks
  // sign-in after several failed attempts (so a *correct* password can be
  // refused for a few minutes), and because verify is best-effort. The address
  // is pre-filled on retry so only the mistyped password needs fixing.
  let email = '';
  let pass = '';
  for (;;) {
    const emailInput = await text({
      message: 'Gmail address',
      initialValue: email,
      validate: (v) => (v.includes('@') ? undefined : 'Enter a valid email address'),
    });
    if (isCancel(emailInput)) {
      cancel('Cancelled.');
      process.exit(1);
    }
    email = String(emailInput).trim();

    // One email = one account — catch a duplicate before the (slow) verify,
    // and re-prompt rather than dead-ending.
    const dupe = await findAccountByEmail(email, alias);
    if (dupe) {
      log.error(
        `${email} is already added as "${dupe.alias}". Each email can be added once — ` +
          `remove it first (\`mailman account remove ${dupe.alias}\`) or enter a different address.`,
      );
      continue;
    }

    const passInput = await password({
      message: 'Gmail App Password (16 characters, from https://myaccount.google.com/apppasswords)',
      validate: (v) => (v.trim().length > 0 ? undefined : 'App Password is required'),
    });
    if (isCancel(passInput)) {
      cancel('Cancelled.');
      process.exit(1);
    }
    // Gmail App Passwords are shown grouped as "abcd efgh ijkl mnop" — users
    // paste them with spaces constantly, and SMTP rejects the spaces. Strip.
    pass = String(passInput).replace(/\s+/g, '');

    // The single most common mistake this catches: typing a regular account
    // password (which Google refuses for SMTP/IMAP) instead of a 16-char App
    // Password. Flag the length mismatch up front, before the slow verify.
    if (pass.length !== 16) {
      log.warn(
        `That's ${pass.length} characters — a Gmail App Password is exactly 16. ` +
          'Your normal account password will NOT work here (Google blocks it for SMTP/IMAP). ' +
          'Generate an App Password at https://myaccount.google.com/apppasswords (needs 2-Step Verification on).',
      );
    }

    const s = spinner();
    s.start('Verifying with Gmail…');
    const result = await verifyAppPasswordCredentials({ user: email, pass });
    if (result.ok) {
      s.stop('Gmail accepted these credentials ✓');
      if (result.imapWarning) log.warn(result.imapWarning);
      break;
    }
    s.stop('Gmail rejected these credentials ✗');
    log.error(result.error ?? 'Verification failed.');

    const next = await select({
      message: 'What next?',
      options: [
        { value: 'retry', label: 'Re-enter the address and App Password' },
        { value: 'save', label: "Save it anyway without verifying (I'm sure it's correct)" },
        { value: 'cancel', label: 'Cancel — add nothing' },
      ],
      initialValue: 'retry',
    });
    if (isCancel(next) || next === 'cancel') {
      cancel('Cancelled — no account added.');
      process.exit(1);
    }
    if (next === 'save') {
      log.warn(
        'Saved without verification. If the credentials are wrong, sends will fail silently — ' +
          'run `mailman doctor` to test the login, or `mailman account remove` then re-add to fix.',
      );
      break;
    }
    // retry → loop again
  }

  const { displayName, signature } = await promptProfileDetails();

  return { alias, email, pass, displayName, signature };
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
    if (err instanceof DuplicateEmailError || err instanceof KeyringUnavailableError) {
      fail(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** OAuth2 (browser sign-in) branch of the wizard — for passkey/passwordless
 * users or Workspace tenants that disable App Passwords. Shares alias + email
 * prompts with the App Password path, then hands off to the same browser-
 * consent flow `mailman auth login` uses (which also prompts for the Google
 * Cloud client and profile, and stores a verified refresh token). */
async function addOAuth2AccountInteractive(setDefault?: boolean) {
  const alias = await promptAlias();
  const email = await text({
    message: 'Gmail address for this account',
    validate: (v) => (v.includes('@') ? undefined : 'Enter a valid email address'),
  });
  if (isCancel(email)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const address = String(email).trim();

  // One email = one account — stop before the browser consent dance.
  const dupe = await findAccountByEmail(address, alias);
  if (dupe) {
    fail(
      `${address} is already added as "${dupe.alias}". Each email can be added once — ` +
        `remove it first (\`mailman account remove ${dupe.alias}\`) or use a different address.`,
    );
    process.exit(1);
  }

  try {
    return await authorizeOAuth2Account({ alias, email: address, setDefault });
  } catch (err) {
    if (err instanceof KeyringUnavailableError) {
      fail(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Opens with a quick "how do you want to connect?" choice. App Password is the
 * default (pre-selected → Enter proceeds), so the simple path needs no reading;
 * the Google Cloud client details only appear if you actually pick browser
 * sign-in. (An earlier version dropped this select entirely because the OLD one
 * forced every user through the OAuth explanation first — keeping App Password
 * default-and-first solves that without hiding the browser option, which
 * passkey / passwordless / App-Password-disabled accounts need.)
 */
async function addAccountInteractive(setDefault?: boolean) {
  const method = await select({
    message: 'How do you want to connect this Gmail account?',
    options: [
      { value: 'app-password', label: 'App Password', hint: 'paste a 16-char code from Google — simplest' },
      { value: 'oauth2', label: 'Sign in with browser (OAuth2)', hint: 'no password; works with passkeys / passwordless / App-Password-disabled accounts' },
    ],
    initialValue: 'app-password',
  });
  if (isCancel(method)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  if (method === 'oauth2') {
    return addOAuth2AccountInteractive(setDefault);
  }
  const details = await promptAppPasswordDetails();
  return addAppPasswordAccount(details, setDefault);
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
