import net from 'node:net';
import { intro, outro, log } from '@clack/prompts';
import { getTickerStatus } from '../scheduler/ticker-install.js';

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
      : `v${process.versions.node} — mcp-mailman requires Node >= ${MIN_NODE_MAJOR}`,
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

export async function runDoctor(_args: string[]): Promise<void> {
  intro('mailman — doctor');

  const results = [
    checkNodeVersion(),
    await checkKeyringBackend(),
    await checkTicker(),
    await checkTcpReachable('SMTP reachability', 'smtp.gmail.com', 465),
    await checkTcpReachable('IMAP reachability', 'imap.gmail.com', 993),
  ];

  for (const result of results) {
    if (result.ok) {
      log.success(`${result.name}: ${result.detail}`);
    } else {
      log.error(`${result.name}: ${result.detail}`);
    }
  }

  const allOk = results.every((r) => r.ok);
  outro(allOk ? 'All checks passed' : 'Some checks failed — see above');
  if (!allOk) {
    process.exitCode = 1;
  }
}
