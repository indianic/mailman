import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import type { PeerCertificate, DetailedPeerCertificate } from 'node:tls';
import { intro, outro } from '@clack/prompts';
import { getTickerStatus, type TickerMechanism } from '../scheduler/ticker-install.js';
import { listAccounts, getDecryptedCredentials, getDefaultAlias } from '../accounts.js';
import { verifyCredentials } from '../auth/verify.js';
import { isTlsTrustError, tlsTrustGuidance } from '../auth/tls-trust.js';
import { getServiceName } from '../config/keychain.js';
import { describeActiveBackend } from '../config/keystore/index.js';
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
 * Reports the LIBRARY and nothing else. This used to say "present (keytar can
 * reach the Secret Service)", which is false on a headless box: libsecret is
 * only the client side, and a machine can have the library with nothing serving
 * `org.freedesktop.secrets` on the bus. Whether the store is actually reachable
 * is the separate `OS credential store` probe below — the only check that
 * touches the daemon.
 *
 * Returns null on macOS/Windows, where the credential store is provided by the
 * OS (Keychain / Credential Manager) and there is nothing to install.
 *
 * `ldconfig -p` is the cheap, read-only way to ask. A missing `ldconfig`
 * (musl/Alpine, minimal containers) is reported as "unknown" rather than
 * "missing" — claiming a library is absent because the tool that lists
 * libraries is absent would send people to install the wrong thing.
 */
export function libsecretDependency(activeBackend: string, platform: string = process.platform): CheckResult | null {
  if (platform !== 'linux') return null;

  // libsecret is a dependency of ONE backend. A server running `passphrase` or
  // `env` does not need it, and reporting it as a missing dependency there made
  // `doctor` conclude "Some checks failed" over a setup that works perfectly —
  // found on Alpine/musl, where libsecret is absent and mailman is fine anyway.
  if (activeBackend !== 'os-keychain') {
    return {
      name: 'libsecret',
      ok: true,
      detail: `not needed — only the os-keychain keystore uses it, and this machine is on \`${activeBackend}\``,
    };
  }

  try {
    const out = execFileSync('ldconfig', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const found = /libsecret-1\.so/.test(out);
    return {
      name: 'libsecret',
      ok: found,
      detail: found
        ? 'present (libsecret-1.so is on the library path) — the library only; see `OS credential store` below'
        : "NOT FOUND — keytar links it at runtime, so its native module cannot even load without it",
    };
  } catch {
    return {
      name: 'libsecret',
      // Not a failure: we could not determine it either way, and saying
      // "missing" here would be a guess presented as a fact.
      ok: true,
      detail: 'could not verify (ldconfig unavailable) — the credential-store probe below is the real test',
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
    //
    // The keystore alternative has to be here as well as in the keyring-daemon
    // hint below. Installing libsecret on a headless box moves you from "no
    // library" to "library, but nothing serving the Secret Service" — the next
    // state in the same dead end — so a bare `apt install libsecret-1-0` is only
    // the right advice on a machine that has a desktop session. Caught on a real
    // Ubuntu container: this path never reached the keyring-daemon hint, so a
    // headless server was told to install the library and nothing else.
    return (
      'sudo apt install libsecret-1-0    (or: sudo dnf install libsecret, sudo pacman -S libsecret, apk add libsecret)\n' +
      '                  ...on a headless box, install nothing and pick a keystore that needs no desktop session:\n' +
      '                  mailman auth migrate-keystore --to passphrase    (or --to env, with MAILMAN_MASTER_KEY set)\n' +
      '                  first install with no key yet? MAILMAN_KEYSTORE=passphrase mailman init'
    );
  }
  if (tool === 'node' || tool === 'npm') {
    if (platform === 'darwin') return 'brew install node    (or: https://nodejs.org)';
    if (platform === 'win32') return 'winget install --id OpenJS.NodeJS.LTS -e    (or: https://nodejs.org)';
    return 'see https://nodejs.org/en/download/package-manager';
  }
  if (tool === 'keyring-daemon') {
    // "then log into a desktop session" used to be the whole advice, which is
    // useless on a server: there is no session to log into, and making
    // gnome-keyring work headlessly took (measured, on Ubuntu 24.04) 16 extra
    // packages, a `gnome-keyring-daemon --unlock` systemd user service fed a
    // password file, and `loginctl enable-linger`. On a headless box the honest
    // answer is a different keystore, so that goes first and the desktop hint
    // stays for the machines where it actually applies.
    return (
      'mailman auth migrate-keystore --to passphrase    (headless: derive the key from a passphrase, nothing at rest)\n' +
      '                  ...or --to env, with MAILMAN_MASTER_KEY=<base64> supplied by your platform (containers/CI/systemd)\n' +
      '                  ...or on a first install with no key yet: MAILMAN_KEYSTORE=passphrase mailman init\n' +
      '                  ...or on a desktop Linux machine: sudo apt install gnome-keyring, then log into your desktop session'
    );
  }
  if (tool === 'ticker-dbus') {
    // The next schedule_send repairs the line itself (installTickerIfNeeded
    // upgrades a managed line that is missing environment), so the only thing the
    // user has to do is the part mailman cannot: keep /run/user/$UID alive.
    return (
      'loginctl enable-linger $USER    (/run/user/$UID vanishes when you log out, taking the session bus with it)\n' +
      '                  the ticker line itself is repaired automatically the next time a send is scheduled'
    );
  }
  return `install ${tool} using your platform's package manager`;
}

/**
 * Why the credential store is unreachable, because the fixes are different and
 * the two states are indistinguishable from the outside. Pure + exported so both
 * are testable from a machine where only one of them can be reproduced.
 *
 * `library` — keytar's native module could not load at all. On Linux it links
 * libsecret at runtime, so a headless image that never installed it fails here,
 * and the user sees a linker path with nothing about keyrings in it.
 * `daemon` — the module loaded and found nothing serving the Secret Service on
 * the session bus. Installing libsecret again would change nothing.
 */
export type KeyringFailureKind = 'library' | 'daemon' | 'other';

export function classifyKeyringFailure(message: string): KeyringFailureKind {
  if (/cannot open shared object file|libsecret-1\.so|could not locate the bindings file/i.test(message)) {
    return 'library';
  }
  if (/org\.freedesktop\.secrets|d-?bus|autolaunch|\$DISPLAY/i.test(message)) {
    return 'daemon';
  }
  return 'other';
}

async function checkKeyringBackend(activeBackend: string): Promise<CheckResult & { failure?: KeyringFailureKind }> {
  const name = 'OS credential store';
  const probeAccount = '__mcp-mailman-doctor-probe__';
  // Only a failure when it is the store actually in use. A headless box running
  // the passphrase keystore has a perfectly working setup, and reporting "some
  // checks failed" over a credential store it deliberately does not use is how
  // doctor teaches people to ignore doctor.
  const inUse = activeBackend === 'os-keychain';
  // getServiceName(), not a hardcoded 'mcp-mailman': under
  // MCP_MAILMAN_CONFIG_DIR the service name is namespaced precisely so isolated
  // profiles never touch the real entry, and doctor was writing its probe into
  // the real namespace regardless.
  const service = getServiceName();
  try {
    const keytar = (await import('keytar')).default;
    await keytar.setPassword(service, probeAccount, 'probe');
    const readBack = await keytar.getPassword(service, probeAccount);
    await keytar.deletePassword(service, probeAccount);
    if (readBack !== 'probe') {
      // A store that accepts a write and hands back something else is broken in
      // a way that would surface later as an undecryptable master key.
      return {
        name,
        ok: !inUse,
        detail: `wrote a probe entry but read back ${readBack === null ? 'nothing' : 'a different value'}`,
        failure: inUse ? 'other' : undefined,
      };
    }
    return { name, ok: true, detail: `reachable (write/read/delete probe succeeded)${inUse ? '' : ' — not in use'}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failure = classifyKeyringFailure(message);
    const explanation =
      failure === 'library'
        ? "keytar's native module could not load at all, so this is a missing or unusable libsecret rather than a missing daemon"
        : failure === 'daemon'
          ? 'the library is there, but nothing is serving the Secret Service on the session bus (no gnome-keyring/kwallet)'
          : 'the store answered with an error that is neither a missing library nor a missing daemon';
    if (!inUse) {
      return {
        name,
        ok: true,
        detail: `unreachable, and not in use — the \`${activeBackend}\` keystore holds the master key, so this does not matter here`,
      };
    }
    return { name, ok: false, detail: `unreachable — ${explanation}: ${message}`, failure };
  }
}

/**
 * Which keystore holds the master key. Reads no key material — this must stay
 * silent and promptless, or `doctor` would ask for a passphrase just to tell you
 * which backend is configured.
 */
function keystoreBackendCheck(active: Awaited<ReturnType<typeof describeActiveBackend>>): CheckResult {
  return {
    name: 'Keystore backend',
    // `file` works, but it is a trade-off the user should see reported as one
    // rather than as a green tick.
    ok: !active.degraded,
    detail: `${active.name}, ${active.detail} [${active.source}]`,
  };
}

/**
 * A ticker whose crontab line has no D-Bus session address will fail every
 * scheduled send at 3am, and nothing in an interactive terminal hints at it: the
 * keyring works fine from a shell that *does* have a bus. This is the check that
 * turns that into something visible before it matters.
 */
export interface TickerConcern {
  detail: string;
  /** Set when there is a printable fix for it in the "how to fix" section. */
  fix?: 'ticker-dbus';
}

/**
 * Will the installed ticker actually be able to reach the master key when it
 * fires? Pure and exported because this is unreachable from a test otherwise, and
 * because the whole point is catching it *before* 3am.
 *
 * Returns undefined when there is nothing to say.
 */
export function tickerConcern(input: {
  mechanism: TickerMechanism;
  installed: boolean;
  hasDbusEnv?: boolean;
  backend: string;
  passphraseInEnv: boolean;
}): TickerConcern | undefined {
  // Only crontab is affected: launchd jobs run inside the user's session, and
  // Windows has no D-Bus at all.
  if (!input.installed || input.mechanism !== 'crontab') return undefined;

  // Only the OS credential store needs a session bus. A passphrase/env/file
  // keystore has no bus to reach, so missing D-Bus env is irrelevant there.
  if (input.backend === 'os-keychain' && input.hasDbusEnv === false) {
    return {
      detail:
        'installed in crontab, but the line carries no DBUS_SESSION_BUS_ADDRESS and the keystore is the OS ' +
        'credential store — cron has no session bus, so scheduled sends will fail silently when they fire',
      fix: 'ticker-dbus',
    };
  }

  // mailman will not write a passphrase into a crontab on the user's behalf, so
  // this combination can only be reported, not repaired.
  if (input.backend === 'passphrase' && !input.passphraseInEnv) {
    return {
      detail:
        'installed in crontab with the passphrase keystore, but cron has no way to obtain the passphrase — ' +
        'scheduled sends will fail when they fire. Set MAILMAN_MASTER_PASSPHRASE in the crontab yourself, or ' +
        'switch to a keystore that needs no prompt (`mailman auth migrate-keystore --to env|file`)',
    };
  }

  return undefined;
}

async function checkTicker(backend: string): Promise<CheckResult & { failure?: 'ticker-dbus' }> {
  const status = await getTickerStatus();
  const name = 'Scheduled-send ticker';

  // Not installed isn't a failure on its own — it just means no
  // schedule_send call has happened yet on this machine.
  if (!status.installed) {
    return { name, ok: true, detail: `not installed yet (would use ${status.mechanism})` };
  }

  const concern = tickerConcern({
    mechanism: status.mechanism,
    installed: status.installed,
    hasDbusEnv: status.hasDbusEnv,
    backend,
    passphraseInEnv: Boolean(process.env.MAILMAN_MASTER_PASSPHRASE),
  });
  if (concern) {
    return { name, ok: false, detail: concern.detail, failure: concern.fix };
  }

  return { name, ok: true, detail: `installed (${status.mechanism})` };
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

  // Resolved before the dependencies section, because whether libsecret is a
  // *missing dependency* or merely absent depends on which keystore is active.
  const active = await describeActiveBackend();

  const libsecret = libsecretDependency(active.name);
  if (libsecret) {
    deps.push(libsecret);
    if (!libsecret.ok) missing.push('libsecret');
  }

  section('dependencies');
  check(true, `node ${process.versions.node}`);
  for (const d of deps) {
    check(d.ok, `${d.name}: ${d.detail}`);
  }

  const keyring = await checkKeyringBackend(active.name);
  const ticker = await checkTicker(active.name);
  const results = [
    checkNodeVersion(),
    // Which `mailman` the shell runs. Fails loudly when another package name
    // owns the command — the state npm leaves behind after an `EEXIST: file
    // already exists` install, which npm itself can only describe as a path
    // collision. Reachable via `npx -y <pkg> doctor` while that install is
    // still blocked.
    { name: 'CLI command', ...inspectCliBinary() },
    keyring,
    keystoreBackendCheck(active),
    ticker,
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

  // Route the fix off what the probe actually reported, not off what ldconfig
  // guessed. A present-but-unusable library (wrong arch, no bindings file) used
  // to be advised to install gnome-keyring, which would change nothing; and an
  // `ldconfig`-less image reported libsecret as "could not verify" and so never
  // reached this branch at all. `missing` is deduped below, so overlapping with
  // the dependencies section is harmless.
  if (!keyring.ok && process.platform === 'linux') {
    missing.push(keyring.failure === 'library' ? 'libsecret' : 'keyring-daemon');
  }
  if (ticker.failure) {
    missing.push(ticker.failure);
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
