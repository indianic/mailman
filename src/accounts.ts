import { getAccountsPath } from './config/paths.js';
import { readJsonFile, updateJsonFile } from './config/store.js';
import {
  AccountsFileSchema,
  DEFAULT_ACCOUNTS_FILE,
  AppPasswordCredentialsSchema,
  OAuth2CredentialsSchema,
  type Account,
} from './config/schema.js';
import { encrypt, decrypt } from './config/crypto.js';
import { getOrCreateMasterKey, getMasterKeyOrThrow } from './config/keychain.js';
import { getSettings, updateSettings } from './settings.js';
import { ErrorCodes, type ErrorCode } from './errors.js';

export class AccountResolutionError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when adding an account whose email is already configured under a different alias. */
export class DuplicateEmailError extends Error {
  code = ErrorCodes.DUPLICATE_EMAIL;
  constructor(
    public email: string,
    public existingAlias: string,
  ) {
    super(
      `${email} is already configured as account "${existingAlias}". Each email can only be added once — ` +
        `remove it first (\`mailman account remove ${existingAlias}\`), or re-add under that same alias to update it.`,
    );
  }
}

/** Case-insensitive lookup of an account by email, optionally ignoring one alias (the one being updated). */
export async function findAccountByEmail(email: string, exceptAlias?: string): Promise<Account | undefined> {
  const accounts = await listAccounts();
  const target = email.trim().toLowerCase();
  return accounts.find((a) => a.email.toLowerCase() === target && a.alias !== exceptAlias);
}

export async function listAccounts(): Promise<Account[]> {
  const file = await readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE);
  return file.accounts;
}

export async function getDefaultAlias(): Promise<string | null> {
  const settings = await getSettings();
  return settings.defaultAccount;
}

/**
 * Full resolution chain from docs/PLAN.md's "Multi-account + settings"
 * section: explicit alias -> the single configured account -> the
 * settings-driven default -> AMBIGUOUS_ACCOUNT. settings.json's
 * defaultAccount is the only source of truth for "default" — accounts
 * never carry their own isDefault flag (see config/schema.ts).
 */
export async function resolveAccount(alias?: string): Promise<Account> {
  const accounts = await listAccounts();

  if (alias) {
    const found = accounts.find((a) => a.alias === alias);
    if (!found) {
      throw new AccountResolutionError(ErrorCodes.ACCOUNT_NOT_FOUND, `No configured account with alias "${alias}"`);
    }
    return found;
  }

  if (accounts.length === 0) {
    throw new AccountResolutionError(
      ErrorCodes.ACCOUNT_NOT_FOUND,
      'No accounts configured yet — run `mailman init`',
    );
  }
  if (accounts.length === 1) {
    return accounts[0];
  }

  const defaultAlias = await getDefaultAlias();
  const defaultAccount = defaultAlias ? accounts.find((a) => a.alias === defaultAlias) : undefined;
  if (defaultAccount) {
    return defaultAccount;
  }

  throw new AccountResolutionError(
    ErrorCodes.AMBIGUOUS_ACCOUNT,
    `Multiple accounts configured (${accounts.map((a) => a.alias).join(', ')}) and no default set — ` +
      'pass an explicit account alias or run `mailman account set-default <alias>`',
  );
}

export type ConfigureAccountInput =
  | {
      alias: string;
      email: string;
      method: 'app-password';
      credentials: { user: string; pass: string };
      setDefault?: boolean;
      displayName?: string;
      signature?: string;
    }
  | {
      alias: string;
      email: string;
      method: 'oauth2';
      credentials: { clientId: string; clientSecret: string; refreshToken: string };
      setDefault?: boolean;
      displayName?: string;
      signature?: string;
    };

/**
 * Shared by the `configure_account` MCP tool and the `init`/`account add`/
 * `auth login` CLI commands. First account ever added becomes default
 * automatically (in settings.json, not on the account record); later ones
 * only if `setDefault` is passed. Credentials are encrypted before ever
 * touching disk — see docs/PLAN.md's Security model.
 */
export async function configureAccount(input: ConfigureAccountInput): Promise<{ account: Account; isDefault: boolean }> {
  const masterKey = await getOrCreateMasterKey();
  const encryptedCredentials = encrypt(masterKey, JSON.stringify(input.credentials));

  let isFirstAccount = false;
  const file = await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => {
    // One email = one account. Re-adding the SAME alias updates it (that's the
    // documented "add or update" path); a DIFFERENT alias with an already-used
    // email is rejected rather than silently creating a confusing duplicate.
    const emailOwner = current.accounts.find(
      (a) => a.email.toLowerCase() === input.email.trim().toLowerCase() && a.alias !== input.alias,
    );
    if (emailOwner) {
      throw new DuplicateEmailError(input.email, emailOwner.alias);
    }

    isFirstAccount = current.accounts.length === 0;
    const withoutSameAlias = current.accounts.filter((a) => a.alias !== input.alias);
    const newAccount: Account = {
      alias: input.alias,
      email: input.email,
      method: input.method,
      credentials: encryptedCredentials,
      displayName: input.displayName,
      signature: input.signature,
    };
    return { ...current, accounts: [...withoutSameAlias, newAccount] };
  });

  if (isFirstAccount || input.setDefault) {
    await updateSettings((current) => ({ ...current, defaultAccount: input.alias }));
  }

  const account = file.accounts.find((a) => a.alias === input.alias)!;
  const isDefault = (await getDefaultAlias()) === input.alias;
  return { account, isDefault };
}

export interface UpdateAccountProfileInput {
  displayName?: string | null;
  signature?: string | null;
}

/**
 * Updates displayName/signature on an existing account without touching its
 * (encrypted) credentials. `undefined` leaves a field as-is; `null` clears
 * it — distinguishing "not passed" from "explicitly remove" the same way
 * update_settings/update_account_profile's caller expects.
 */
export async function updateAccountProfile(alias: string, input: UpdateAccountProfileInput): Promise<Account> {
  const file = await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => {
    const target = current.accounts.find((a) => a.alias === alias);
    if (!target) {
      throw new AccountResolutionError(ErrorCodes.ACCOUNT_NOT_FOUND, `No configured account with alias "${alias}"`);
    }
    const updated: Account = {
      ...target,
      displayName: input.displayName === null ? undefined : input.displayName ?? target.displayName,
      signature: input.signature === null ? undefined : input.signature ?? target.signature,
    };
    return { ...current, accounts: current.accounts.map((a) => (a.alias === alias ? updated : a)) };
  });
  return file.accounts.find((a) => a.alias === alias)!;
}

export class AccountRemovalConfirmationError extends Error {
  code = ErrorCodes.CONFIRMATION_REQUIRED;
}

/**
 * Requires `confirmRemoval: true` when removing the last remaining
 * account or the current default — one ambiguous instruction shouldn't
 * silently leave zero configured accounts. Clears settings.defaultAccount
 * if the removed account was the default.
 */
export async function removeAccount(alias: string, confirmRemoval?: boolean): Promise<void> {
  const accounts = await listAccounts();
  const target = accounts.find((a) => a.alias === alias);
  if (!target) {
    throw new AccountResolutionError(ErrorCodes.ACCOUNT_NOT_FOUND, `No configured account with alias "${alias}"`);
  }

  const defaultAlias = await getDefaultAlias();
  const isLastAccount = accounts.length === 1;
  const isCurrentDefault = defaultAlias === alias;

  if ((isLastAccount || isCurrentDefault) && !confirmRemoval) {
    const reason = isLastAccount ? 'the last remaining account' : 'the current default account';
    throw new AccountRemovalConfirmationError(
      `"${alias}" is ${reason} — pass confirmRemoval: true to remove it anyway.`,
    );
  }

  await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => ({
    ...current,
    accounts: current.accounts.filter((a) => a.alias !== alias),
  }));

  if (isCurrentDefault) {
    await updateSettings((current) => ({ ...current, defaultAccount: null }));
  }
}

/**
 * Decrypts one account's credentials — called only at the moment they're
 * actually needed (confirm_send dispatch), not whenever an Account record
 * is read, to keep the plaintext secret's in-memory lifetime as short as
 * possible. Throws NoMasterKeyError/KeyringUnavailableError (never a
 * plaintext fallback) if the keychain has no matching key — e.g. this
 * accounts.json was copied from another machine.
 */
export async function getDecryptedCredentials(
  account: Account,
): Promise<{ user: string; pass: string } | { clientId: string; clientSecret: string; refreshToken: string }> {
  const masterKey = await getMasterKeyOrThrow();
  const plaintext = decrypt(masterKey, account.credentials);
  const parsed = JSON.parse(plaintext);
  return account.method === 'app-password'
    ? AppPasswordCredentialsSchema.parse(parsed)
    : OAuth2CredentialsSchema.parse(parsed);
}
