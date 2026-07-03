import net from 'node:net';
import { intro, outro } from '@clack/prompts';
import { getTickerStatus } from '../scheduler/ticker-install.js';
import { listAccounts, getDecryptedCredentials, getDefaultAlias } from '../accounts.js';
import { verifyCredentials } from '../auth/verify.js';
import { section, check, detail } from './tree.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
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

function checkTcpReachable(name: string, host: string, port: number, timeoutMs = 5000): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const finish = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ name, ok, detail });
    };
    socket.once('connect', () => finish(true, `reachable (${host}:${port})`));
    socket.once('timeout', () => finish(false, `timed out connecting to ${host}:${port}`));
    socket.once('error', (err) => finish(false, `unreachable (${host}:${port}): ${err.message}`));
  });
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

  const results = [
    checkNodeVersion(),
    await checkKeyringBackend(),
    await checkTicker(),
    await checkTcpReachable('SMTP reachability', 'smtp.gmail.com', 465),
    await checkTcpReachable('IMAP reachability', 'imap.gmail.com', 993),
  ];

  section('checks');
  for (const r of results) {
    check(r.ok, `${r.name}: ${r.detail}`);
  }

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

  const allOk = [...results, ...accountResults].every((r) => r.ok);
  outro(allOk ? 'All checks passed' : 'Some checks failed — see above');
  if (!allOk) {
    process.exitCode = 1;
  }
}
