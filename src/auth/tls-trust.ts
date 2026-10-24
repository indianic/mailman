/**
 * TLS-trust failures that masquerade as rejected credentials.
 *
 * On a managed Windows machine the connection to Gmail is routinely
 * intercepted: corporate TLS inspection (Zscaler, Netskope, Palo Alto) and
 * antivirus "scan encrypted connections" (Kaspersky, ESET, Avast, Bitdefender)
 * both terminate the session and re-sign it with their own root CA. Windows
 * trusts that root, so the browser is perfectly happy — but Node ships its own
 * bundled Mozilla CA list and does not read the OS store, so the handshake
 * fails with `self-signed certificate in certificate chain` *before* a single
 * byte of authentication is exchanged.
 *
 * Reporting that as "Gmail rejected these credentials" is the exact opposite of
 * what happened — Gmail never saw them — and it sends the user off to
 * regenerate a perfectly good App Password. Telling the two apart is what this
 * module is for.
 */

/**
 * OpenSSL/Node verification codes. Matched on a best-effort basis only:
 * nodemailer's `_formatError` overwrites `err.code` with its own `ESOCKET`
 * before the error reaches us (smtp-connection/index.js), so for the SMTP path
 * the original code is gone and only the message survives. imapflow and raw
 * `tls.connect` do preserve it.
 */
const TLS_TRUST_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'EPROTO',
]);

/**
 * Message fallback for the SMTP path. Both OpenSSL spellings are covered —
 * OpenSSL 3 says "self-signed certificate in certificate chain", OpenSSL 1.x
 * said "self signed certificate in certificate chain" (no hyphen), and old
 * Node builds are exactly the ones people hit this on.
 */
const TLS_TRUST_MESSAGE =
  /self[- ]signed certificate|unable to (?:verify the first certificate|get (?:local )?issuer certificate)|certificate (?:has expired|is not trusted|chain)|cert_untrusted|altnames|ERR_TLS|SSL routines|wrong version number|unsupported protocol/i;

/**
 * True when a verify/connect failure is about certificate trust, not
 * credentials. Walks `cause`: Node's `fetch` (the OAuth2 token exchange)
 * reports only `TypeError: fetch failed` and hides the real certificate error
 * one level down.
 */
export function isTlsTrustError(err: unknown, depth = 0): boolean {
  if (typeof err === 'string') return TLS_TRUST_MESSAGE.test(err);
  const e = err as { code?: string; message?: string; reason?: string; cause?: unknown } | null | undefined;
  if (!e || depth > 4) return false;
  if (e.code && TLS_TRUST_CODES.has(e.code)) return true;
  if (TLS_TRUST_MESSAGE.test(`${e.message ?? ''} ${e.reason ?? ''}`)) return true;
  return e.cause !== undefined && e.cause !== e && isTlsTrustError(e.cause, depth + 1);
}

/** The most specific message in a `cause` chain — what to quote as the reason. */
export function tlsFailureReason(err: unknown, depth = 0): string {
  const e = err as { message?: string; cause?: unknown } | null | undefined;
  if (!e || depth > 4) return String(err);
  if (e.cause !== undefined && e.cause !== e) {
    const deeper = tlsFailureReason(e.cause, depth + 1);
    if (deeper) return deeper;
  }
  return e.message ?? String(err);
}

/**
 * Whether this Node accepts `--use-system-ca` (which makes it trust the OS
 * certificate store, where the intercepting root already lives). Asked of the
 * runtime rather than compared against a version number: the flag was
 * backported, so "Node >= X" is not a straight answer, and
 * `allowedNodeEnvironmentFlags` is precisely the set that `NODE_OPTIONS`
 * accepts — which is how we tell the user to set it.
 */
export function supportsSystemCa(): boolean {
  try {
    return process.allowedNodeEnvironmentFlags.has('--use-system-ca');
  } catch {
    return false;
  }
}

export interface TlsGuidanceOptions {
  platform?: NodeJS.Platform;
  systemCaSupported?: boolean;
  /** Root CA that signed what we were served, when a probe could name it. */
  issuer?: string;
}

/**
 * The full "your certificate chain is being intercepted" explainer, in the
 * shell syntax of the platform it's printed on. Pure — takes the platform and
 * the runtime's flag support as inputs so it stays testable off-Windows.
 */
export function tlsTrustGuidance(reason: string, options: TlsGuidanceOptions = {}): string {
  const { platform = process.platform, systemCaSupported = supportsSystemCa(), issuer } = options;
  const win = platform === 'win32';
  const store = win ? 'Windows certificate store' : 'system certificate store';
  // Recent Node appends its own one-line hint about --use-system-ca to these
  // messages. Dropped from the quote so the same advice isn't given twice,
  // once truncated and once in full.
  const quoted = reason.replace(/;\s*if the root CA is installed locally.*$/i, '').trim();

  const lines: string[] = [
    `Gmail's certificate could not be verified (${quoted}), so the connection was closed before any password was sent. This is a certificate-trust problem on this machine, not a wrong App Password — Gmail never saw the credentials.`,
    // Deliberately not phrased as "so you are being intercepted": the same
    // verification failure happens with a stale/broken CA store, and in that
    // case the chain ends at a perfectly legitimate public root (Gmail's is
    // "GTS Root R1"). Naming it and letting the reader judge is the only
    // claim that's true either way.
    issuer
      ? `The chain ends at "${issuer}". If that isn't a public certificate authority you recognise, HTTPS traffic on this machine is being re-signed — corporate TLS inspection (Zscaler, Netskope, Palo Alto) or antivirus "scan encrypted connections" (Kaspersky, ESET, Avast, Bitdefender).`
      : 'Something here is re-signing HTTPS traffic: corporate TLS inspection (Zscaler, Netskope, Palo Alto) or antivirus "scan encrypted connections" (Kaspersky, ESET, Avast, Bitdefender).',
    `Your browser accepts it because ${win ? 'Windows' : 'the OS'} trusts that root CA. Node ships its own CA list and never reads the ${store}.`,
  ];

  if (systemCaSupported) {
    lines.push(
      `Fix — let Node trust the ${store}, then run the command again:`,
      win
        ? '    PowerShell   $env:NODE_OPTIONS = "--use-system-ca"\n' +
          '    cmd.exe      set NODE_OPTIONS=--use-system-ca\n' +
          '    permanent    setx NODE_OPTIONS "--use-system-ca"   (then reopen the terminal)'
        : '    export NODE_OPTIONS=--use-system-ca',
    );
  } else {
    lines.push(
      `This Node (${process.version}) is too old for --use-system-ca, which would trust the ${store} directly. Upgrading Node is the easiest fix; otherwise point Node at the root CA by hand:`,
    );
  }

  lines.push(
    `If it still fails, the root CA isn't in the ${store} either — export it${win ? ' (certmgr.msc → Trusted Root Certification Authorities → Export as Base-64 .cer)' : ''} and point Node at the file:`,
    win
      ? '    set NODE_EXTRA_CA_CERTS=C:\\path\\to\\root.cer'
      : '    export NODE_EXTRA_CA_CERTS=/path/to/root.pem',
    'Or turn off HTTPS/SSL scanning in the antivirus for smtp.gmail.com:465 and imap.gmail.com:993.',
  );

  return lines.join('\n');
}
