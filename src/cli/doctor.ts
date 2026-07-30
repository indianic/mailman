import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import type { PeerCertificate, DetailedPeerCertificate } from 'node:tls';
import { intro, outro } from '@clack/prompts';
import { getTickerStatus } from '../scheduler/ticker-install.js';
import { listAccounts, getDecryptedCredentials, getDefaultAlias } from '../accounts.js';
import { verifyCredentials } from '../auth/verify.js';
import { isTlsTrustError, tlsTrustGuidance } from '../auth/tls-trust.js';
import { inspectCliBinary } from './bin-conflict.js';
import { section, check, detail, attention } from './tree.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Long-form fix printed once below the checks, not inline per row. */
  guidance?: string;
}

const MIN_NODE_MAJOR = 18;

function checkNodeVersion(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    name: 'Node version',
    ok,
    detail: ok
      ? `v${process.versions.node} (>= ${MIN_NODE_MAJOR} required)`
      : `v${process.versions.node} — mailman requires Node >= ${MIN_NODE_MAJOR}`,
  };
}

/** First line of `<cmd> --version`, or null when the command isn't on PATH. */
function versionOf(cmd: string): string | null {
  try {
    return execFileSync(cmd, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      .trim();
  } catch {
    return null;
  }
}

/**
 * Is libsecret actually present? Linux only — it is keytar's native backend
 * there, and the one external library mailman genuinely needs.
 *
 * Returns null on macOS/Windows, where the credential store is provided by the
 * OS (Keychain / Credential Manager) and there is nothing to install.
 *
 * `ldconfig -p` is the cheap, read-only way to ask. A missing `ldconfig`
 * (musl/Alpine, minimal containers) is reported as "unknown" rather than
 * "missing" — claiming a library is absent because the tool that lists
 * libraries is absent would send people to install the wrong thing.
 */
function checkLibsecret(): CheckResult | null {
  if (process.platform !== 'linux') return null;
  try {
    const out = execFileSync('ldconfig', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const found = /libsecret-1\.so/.test(out);
    return {
      name: 'libsecret',
      ok: found,
      detail: found
        ? 'present (keytar can reach the Secret Service)'
        : 'NOT FOUND — keytar cannot store the master key without it',
    };
  } catch {
    return {
      name: 'libsecret',
      // Not a failure: we could not determine it either way, and saying
      // "missing" here would be a guess presented as a fact.
      ok: true,
      detail: 'could not verify (ldconfig unavailable) — the keyring probe below is the real test',
    };
  }
}

/**
 * The copy-pasteable command that installs a missing prerequisite on this
 * platform. Pure + exported so the per-platform strings are testable from any
 * machine — the Windows and Linux branches are otherwise unverifiable here.
 *
 * These are PRINTED, never executed. Installing a system library needs
 * administrator rights and a package manager; a CLI that silently runs
 * `sudo apt install` to fix its own prerequisite is doing something the user
 * did not ask for, on a machine it does not own.
 */
export function installHint(tool: string, platform: string = process.platform): string {
  if (tool === 'libsecret') {
    // Linux-only by construction; the other platforms ship a credential store.
    return 'sudo apt install libsecret-1-0    (or: sudo dnf install libsecret, sudo pacman -S libsecret)';
  }
  if (tool === 'node' || tool === 'npm') {
    if (platform === 'darwin') return 'brew install node    (or: https://nodejs.org)';
    if (platform === 'win32') return 'winget install --id OpenJS.NodeJS.LTS -e    (or: https://nodejs.org)';
    return 'see https://nodejs.org/en/download/package-manager';
  }
  if (tool === 'keyring-daemon') {
    return 'sudo apt install gnome-keyring    (or: sudo dnf install gnome-keyring) — then log into a desktop session';
  }
  return `install ${tool} using your platform's package manager`;
}

async function checkKeyringBackend(): Promise<CheckResult> {
  const probeAccount = '__mcp-mailman-doctor-probe__';
  try {
    const keytar = (await import('keytar')).default;
    await keytar.setPassword('mcp-mailman', probeAccount, 'probe');
    await keytar.getPassword('mcp-mailman', probeAccount);
    await keytar.deletePassword('mcp-mailman', probeAccount);
    return { name: 'Keyring backend', ok: true, detail: 'reachable (write/read/delete probe succeeded)' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Keyring backend',
      ok: false,
      detail: `unreachable — ${message}. On headless Linux this usually means no Secret Service daemon (gnome-keyring/kwallet) is running.`,
    };
  }
}

async function checkTicker(): Promise<CheckResult> {
  const status = await getTickerStatus();
  // Not installed isn't a failure on its own — it just means no
  // schedule_send call has happened yet on this machine.
  return {
    name: 'Scheduled-send ticker',
    ok: true,
    detail: status.installed ? `installed (${status.mechanism})` : `not installed yet (would use ${status.mechanism})`,
  };
}

/**
 * Walk a peer chain to the root and name whoever signed it. A chain that ends
 * at something other than a Google/GlobalSign root is the single clearest
 * evidence of TLS interception, and naming it ("ESET SSL Filter CA") turns an
 * abstract certificate error into something the user recognises as installed
 * on their own machine.
 */
export function rootIssuerName(cert: DetailedPeerCertificate | PeerCertificate | undefined, host: string): string | undefined {
  let node = cert as DetailedPeerCertificate | undefined;
  // Self-signed roots point `issuerCertificate` back at themselves; the depth
  // cap is the guard against that loop and against pathological chains.
  for (let depth = 0; node && depth < 10; depth += 1) {
    const parent = node.issuerCertificate;
    if (!parent || parent === node) break;
    node = parent;
  }
  // `O` is typed as string | string[] — a certificate may carry several
  // organisation values, and only the first is worth naming.
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const name = first(node?.subject?.CN) ?? first(node?.subject?.O) ?? first(node?.issuer?.CN);
  // A chain that terminates at the hostname itself is a bare self-signed leaf:
  // no root was presented, so there is no interceptor to name and saying
  // 'issued by "smtp.gmail.com", not by Google' would be nonsense. Fall back
  // to the generic explanation instead of inventing a culprit.
  return name && name !== host ? name : undefined;
}

/**
 * Second pass, run only after a verified handshake has already failed: reopen
 * the connection without verification purely to read the chain we were served,
 * so the guidance can name the interceptor instead of describing it in the
 * abstract. Deliberately cannot influence the pass/fail verdict — that is
 * decided in `checkTlsReachable` below by a fully verified handshake — and
 * nothing is ever written to this socket, so no credentials can reach whatever
 * answered. Resolves undefined if the chain can't be read; naming is a bonus.
 */
function probeInterceptorName(host: string, port: number, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    const finish = (issuer?: string) => {
      socket.destroy();
      resolve(issuer);
    };
    socket.once('secureConnect', () => finish(rootIssuerName(socket.getPeerCertificate(true), host)));
    socket.once('timeout', () => finish(undefined));
    socket.once('error', () => finish(undefined));
  });
}

/**
 * Both Gmail ports are implicit TLS, so the bare TCP connect this check used to
 * do proved almost nothing: an intercepting proxy or antivirus SSL scanner
 * accepts the socket and reports "reachable" while every real connection dies
 * at the handshake. Completing a *verified* handshake is what lets doctor
 * explain the `self-signed certificate in certificate chain` failure users hit
 * during setup — the certificate is checked exactly as strictly as a real send
 * would check it.
 */
async function checkTlsReachable(name: string, host: string, port: number, timeoutMs = 8000): Promise<CheckResult> {
  const outcome = await new Promise<{ ok: boolean; trust: boolean; reason: string }>((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: timeoutMs });
    const finish = (result: { ok: boolean; trust: boolean; reason: string }) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () => finish({ ok: true, trust: false, reason: '' }));
    socket.once('timeout', () => finish({ ok: false, trust: false, reason: `timed out connecting to ${host}:${port}` }));
    socket.once('error', (err) => finish({ ok: false, trust: isTlsTrustError(err), reason: err.message }));
  });

  if (outcome.ok) return { name, ok: true, detail: `reachable, certificate verified (${host}:${port})` };
  if (!outcome.trust) return { name, ok: false, detail: `unreachable (${host}:${port}): ${outcome.reason}` };

  const issuer = await probeInterceptorName(host, port, timeoutMs);
  return {
    name,
    ok: false,
    detail: `${host}:${port} answers, but its certificate is not trusted — ${outcome.reason}${issuer ? ` (chain ends at "${issuer}")` : ''}`,
    guidance: tlsTrustGuidance(outcome.reason, { issuer }),
  };
}

/**
 * Live per-account credential check — the reason `doctor` is now the "is my
 * setup actually working?" command, not just an environment pre-flight. For
 * each configured account it decrypts the stored credentials and performs a
 * real Gmail login (SMTP verify + IMAP probe, or an OAuth2 token exchange),
 * so a password revoked/changed after setup shows up here instead of on the
 * next silent send failure. Skipped with `--offline` to keep doctor network-
 * free. Zero accounts is reported (not a failure) so first-run `doctor` is
 * still green.
 */
async function checkAccountCredentials(): Promise<CheckResult[]> {
  const [accounts, defaultAlias] = await Promise.all([listAccounts(), getDefaultAlias()]);
  if (accounts.length === 0) {
    return [{ name: 'Accounts', ok: true, detail: 'none configured yet — run `mailman init`' }];
  }

  const results: CheckResult[] = [];
  for (const account of accounts) {
    const label = `Account "${account.alias}" (${account.email}${account.alias === defaultAlias ? ', default' : ''})`;
    try {
      const creds = await getDecryptedCredentials(account);
      const result =
        account.method === 'app-password'
          ? await verifyCredentials({ method: 'app-password', credentials: creds as { user: string; pass: string } })
          : await verifyCredentials({
              method: 'oauth2',
              credentials: creds as { clientId: string; clientSecret: string; refreshToken: string },
            });
      if (result.ok) {
        results.push({ name: label, ok: true, detail: `${account.method} — Gmail login OK${result.imapWarning ? ' (IMAP unavailable)' : ''}` });
        if (result.imapWarning) results.push({ name: `  ↳ ${account.alias} IMAP`, ok: true, detail: result.imapWarning });
      } else {
        results.push({ name: label, ok: false, detail: result.error ?? 'credentials rejected' });
      }
    } catch (err) {
      // Decrypt failure = keychain has no matching key (e.g. accounts.json
      // copied from another machine). Surface it as a failed check.
      results.push({ name: label, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export async function runDoctor(args: string[]): Promise<void> {
  intro('mailman — doctor');
  const offline = args.includes('--offline');
  const fix = args.includes('--fix');

  // Prerequisites this machine must already have, checked before anything that
  // depends on them. Deliberately NOT a copy of the sibling project's list:
  // that one checks git because Baileys pulls libsignal from a git URL, and
  // mailman has no git-URL dependency at all. What mailman actually needs is
  // npm (self-update shells out to it) and, on Linux only, libsecret.
  const missing: string[] = [];
  const deps: CheckResult[] = [];

  const npmVersion = versionOf('npm');
  deps.push({
    name: 'npm',
    ok: Boolean(npmVersion),
    detail: npmVersion
      ? `${npmVersion.replace(/^v/, '')} (used by \`mailman update\`)`
      : 'NOT FOUND — `mailman update` cannot self-update without a package manager',
  });
  if (!npmVersion) missing.push('npm');

  const libsecret = checkLibsecret();
  if (libsecret) {
    deps.push(libsecret);
    if (!libsecret.ok) missing.push('libsecret');
  }

  section('dependencies');
  check(true, `node ${process.versions.node}`);
  for (const d of deps) {
    check(d.ok, `${d.name}: ${d.detail}`);
  }

  const results = [
    checkNodeVersion(),
    // Which `mailman` the shell runs. Fails loudly when another package name
    // owns the command — the state npm leaves behind after an `EEXIST: file
    // already exists` install, which npm itself can only describe as a path
    // collision. Reachable via `npx -y <pkg> doctor` while that install is
    // still blocked.
    { name: 'CLI command', ...inspectCliBinary() },
    await checkKeyringBackend(),
    await checkTicker(),
    await checkTlsReachable('SMTP reachability', 'smtp.gmail.com', 465),
    await checkTlsReachable('IMAP reachability', 'imap.gmail.com', 993),
  ];

  section('checks');
  for (const r of results) {
    check(r.ok, `${r.name}: ${r.detail}`);
  }

  // Printed once, not per row: SMTP and IMAP fail together when the machine
  // intercepts TLS, and the fix is the same paragraph both times.
  const guidance = results.find((r) => !r.ok && r.guidance)?.guidance;
  if (guidance) attention(guidance);

  // Live account logins are the slow, network-bound part — run them in their
  // own section, and let `--offline` skip them for a fast environment-only run.
  let accountResults: CheckResult[] = [];
  if (offline) {
    section('accounts');
    detail('skipped (--offline)');
  } else {
    accountResults = await checkAccountCredentials();
    section('accounts');
    for (const r of accountResults) {
      check(r.ok, `${r.name}: ${r.detail}`);
    }
  }

  // A failing keyring probe on Linux usually means libsecret is present but no
  // Secret Service daemon is running — a different fix from a missing library,
  // so it gets its own entry rather than being folded into "install libsecret".
  const keyringFailed = results.some((r) => r.name === 'Keyring backend' && !r.ok);
  if (keyringFailed && process.platform === 'linux' && !missing.includes('libsecret')) {
    missing.push('keyring-daemon');
  }

  if (missing.length > 0) {
    section('how to fix');
    if (fix) {
      // Printed, never run — see installHint.
      for (const tool of [...new Set(missing)]) detail(`${tool}:  ${installHint(tool)}`);
      detail('');
      detail('re-run `mailman doctor` once installed');
    } else {
      detail(`missing: ${[...new Set(missing)].join(', ')} — run: mailman doctor --fix`);
    }
  }

  const allOk = [...results, ...accountResults].every((r) => r.ok) && deps.every((d) => d.ok);
  outro(allOk ? 'All checks passed' : 'Some checks failed — see above');
  if (!allOk) {
    process.exitCode = 1;
  }
}
