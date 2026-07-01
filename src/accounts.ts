import { getAccountsPath } from './config/paths.js';
import { readJsonFile, updateJsonFile } from './config/store.js';
import { AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, type Account } from './config/schema.js';
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

export interface ConfigureAppPasswordAccountInput {
  alias: string;
  email: string;
  method: 'app-password';
  credentials: { user: string; pass: string };
  setDefault?: boolean;
}

/**
 * Shared by the `configure_account` MCP tool and the `init`/`account add`
 * CLI commands — one account-creation function, two entry points. First
 * account ever added becomes default automatically; later ones only if
 * `setDefault` is passed.
 */
export async function configureAccount(input: ConfigureAppPasswordAccountInput): Promise<Account> {
  const file = await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => {
    const isFirstAccount = current.accounts.length === 0;
    const makeDefault = isFirstAccount || Boolean(input.setDefault);
    const withoutSameAlias = current.accounts.filter((a) => a.alias !== input.alias);

    const newAccount: Account = {
      alias: input.alias,
      email: input.email,
      method: 'app-password',
      isDefault: makeDefault,
      credentials: input.credentials,
    };

    const accounts = makeDefault
      ? [...withoutSameAlias.map((a) => ({ ...a, isDefault: false })), newAccount]
      : [...withoutSameAlias, newAccount];

    return { ...current, accounts };
  });

  return file.accounts.find((a) => a.alias === input.alias)!;
}
