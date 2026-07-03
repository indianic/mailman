import { createAppPasswordTransport, type AppPasswordCredentials } from './app-password.js';
import { getAccessToken, type OAuth2Credentials } from './oauth2.js';
import { verifyImapConnection } from '../mail/imap-client.js';

/**
 * Result of a live credential check against Gmail.
 *
 * `ok` is the hard gate: it's only true when SMTP authentication succeeds, i.e.
 * the App Password can actually send. `imapWarning` is a soft signal — sending
 * works but the read side (IMAP) couldn't connect, which is a rare account
 * config (IMAP disabled) rather than a bad password. Setup keeps looping while
 * `ok` is false; it proceeds with a warning when only `imapWarning` is set.
 */
export interface VerifyResult {
  ok: boolean;
  error?: string;
  imapWarning?: string;
}

/** Turn a transport/IMAP failure into a short, actionable line for the terminal. */
function describe(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const msg = e?.response || e?.message || String(err);
  if (
    e?.code === 'EAUTH' ||
    e?.responseCode === 535 ||
    /invalid|username|password|credential|badcredentials|authentication failed/i.test(msg)
  ) {
    return 'Gmail rejected these credentials. Check the address, and that the App Password is the 16-character one from https://myaccount.google.com/apppasswords (2-Step Verification must be on).';
  }
  if (
    e?.code === 'ETIMEDOUT' ||
    e?.code === 'ECONNREFUSED' ||
    e?.code === 'ENOTFOUND' ||
    /timeout|network|getaddrinfo|econnreset/i.test(msg)
  ) {
    return `Couldn't reach Gmail — network issue: ${msg}. Check your connection and try again.`;
  }
  return msg;
}

/**
 * Prove an App Password actually works before we store it. SMTP `verify()` is
 * the gate (it authenticates the send path); an IMAP login probe follows as a
 * soft read-side check. Never throws — always resolves to a VerifyResult the
 * setup loop can branch on.
 */
export async function verifyAppPasswordCredentials(creds: AppPasswordCredentials): Promise<VerifyResult> {
  const transport = createAppPasswordTransport(creds);
  try {
    await transport.verify();
  } catch (err) {
    return { ok: false, error: describe(err) };
  } finally {
    try {
      transport.close();
    } catch {
      // best-effort teardown
    }
  }

  try {
    await verifyImapConnection(creds);
    return { ok: true };
  } catch (err) {
    return {
      ok: true,
      imapWarning: `Sending works, but reading (IMAP) couldn't connect: ${describe(err)} Enable IMAP in Gmail settings if you want mailman to list/read/search your inbox.`,
    };
  }
}

/**
 * Prove an OAuth2 refresh token still works before we store it: exchange it
 * for an access token. A successful exchange means the client ID/secret are
 * right and the refresh token is live (not revoked/expired). Never throws.
 */
export async function verifyOAuth2Credentials(creds: OAuth2Credentials): Promise<VerifyResult> {
  try {
    await getAccessToken(creds);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|invalid_client|unauthorized|400|401|refresh token/i.test(msg)) {
      return {
        ok: false,
        error:
          'Google rejected these OAuth2 credentials — the refresh token may be revoked/expired, or the client ID/secret is wrong. Re-run `mailman auth login <alias>` to get a fresh token.',
      };
    }
    if (/timeout|network|getaddrinfo|econnreset|fetch failed/i.test(msg)) {
      return { ok: false, error: `Couldn't reach Google's token endpoint — network issue: ${msg}. Check your connection and try again.` };
    }
    return { ok: false, error: msg };
  }
}

/** Method-dispatching verifier shared by the MCP tool and the doctor check. */
export function verifyCredentials(
  input:
    | { method: 'app-password'; credentials: AppPasswordCredentials }
    | { method: 'oauth2'; credentials: OAuth2Credentials },
): Promise<VerifyResult> {
  return input.method === 'app-password'
    ? verifyAppPasswordCredentials(input.credentials)
    : verifyOAuth2Credentials(input.credentials);
}
