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
import { ErrorCodes, type ErrorCode } from './errors.js';

export class AccountResolutionError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function listAccounts(): Promise<Account[]> {
  const file = await readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE);
  return file.accounts;
}

/**
 * Phase 1 scope: explicit alias, or the single configured account. Phase 5
 * adds the full explicit -> single -> settings-driven-default -> ambiguous
 * chain (docs/PLAN.md's "Multi-account + settings" section) — until then,
 * multiple accounts with no explicit alias is always ambiguous.
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
      'No accounts configured yet — run `mcp-mailman init`',
    );
  }
  if (accounts.length === 1) {
    return accounts[0];
  }
  throw new AccountResolutionError(
    ErrorCodes.AMBIGUOUS_ACCOUNT,
    `Multiple accounts configured (${accounts.map((a) => a.alias).join(', ')}) — pass an explicit account alias`,
  );
}

export type ConfigureAccountInput =
  | {
      alias: string;
      email: string;
      method: 'app-password';
      credentials: { user: string; pass: string };
      setDefault?: boolean;
    }
  | {
      alias: string;
      email: string;
      method: 'oauth2';
      credentials: { clientId: string; clientSecret: string; refreshToken: string };
      setDefault?: boolean;
    };

/**
 * Shared by the `configure_account` MCP tool and the `init`/`account add`/
 * `auth login` CLI commands — one account-creation function, several
 * entry points. First account ever added becomes default automatically;
 * later ones only if `setDefault` is passed. Credentials are encrypted
 * before ever touching disk — see docs/PLAN.md's Security model.
 */
export async function configureAccount(input: ConfigureAccountInput): Promise<Account> {
  const masterKey = await getOrCreateMasterKey();
  const encryptedCredentials = encrypt(masterKey, JSON.stringify(input.credentials));

  const file = await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => {
    const isFirstAccount = current.accounts.length === 0;
    const makeDefault = isFirstAccount || Boolean(input.setDefault);
    const withoutSameAlias = current.accounts.filter((a) => a.alias !== input.alias);

    const newAccount: Account = {
      alias: input.alias,
      email: input.email,
      method: input.method,
      isDefault: makeDefault,
      credentials: encryptedCredentials,
    };

    const accounts = makeDefault
      ? [...withoutSameAlias.map((a) => ({ ...a, isDefault: false })), newAccount]
      : [...withoutSameAlias, newAccount];

    return { ...current, accounts };
  });

  return file.accounts.find((a) => a.alias === input.alias)!;
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
