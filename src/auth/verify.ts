import { createAppPasswordTransport, type AppPasswordCredentials } from './app-password.js';
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
