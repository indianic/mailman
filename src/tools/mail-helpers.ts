import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { getProvider } from '../mail/get-provider.js';
import { NoMasterKeyError, KeyringUnavailableError } from '../config/keychain.js';
import { OAuth2AuthError, OAuth2RateLimitError } from '../auth/oauth2.js';
import { ErrorCodes } from '../errors.js';
import { toolError, type ToolResponse } from '../response.js';
import type { MailProvider } from '../mail/provider.js';

/** Shared by list_recent_emails/search_emails/read_email — one account+provider resolution path, one error mapping. */
export async function resolveProviderOrError(
  accountAlias?: string,
): Promise<{ provider: MailProvider } | { errorResponse: ToolResponse }> {
  try {
    const account = await resolveAccount(accountAlias);
    const provider = await getProvider(account);
    return { provider };
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      return { errorResponse: toolError(err.code, err.message) };
    }
    if (err instanceof NoMasterKeyError || err instanceof KeyringUnavailableError) {
      return { errorResponse: toolError(ErrorCodes.NO_MASTER_KEY, err.message) };
    }
    throw err;
  }
}

export function mapProviderError(err: unknown): ToolResponse {
  if (err instanceof OAuth2AuthError) {
    return toolError(ErrorCodes.AUTH_EXPIRED, err.message);
  }
  if (err instanceof OAuth2RateLimitError) {
    return toolError(ErrorCodes.RATE_LIMITED, err.message, { retryAfterMs: err.retryAfterMs });
  }
  throw err;
}
