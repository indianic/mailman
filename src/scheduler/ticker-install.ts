import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { getPackageName } from '../version.js';

const execFileAsync = promisify(execFile);

const LAUNCHD_LABEL = 'com.mcp-mailman.ticker';
const CRON_MARKER = '# mcp-mailman-ticker';
const SCHTASKS_NAME = 'mcp-mailman-ticker';
const POLL_INTERVAL_SECONDS = 180; // within the 1-5 min range docs/PLAN.md specifies

// The npm package name the OS ticker `npx`-resolves at fire time. This is
// the published *package* name, NOT the CLI binary name (mcp-mailman) — they
// differ. Read from package.json because mailman ships under two names
// (@integratex/mailman publicly, @indianic/mailman internally); a hardcoded
// literal here would leave one distribution's scheduler resolving a dead
// package name and failing every scheduled send. (labels/markers/log paths
// above stay "mcp-mailman" — local identifiers, not npm package names.)
const NPM_PACKAGE = getPackageName();

export type TickerMechanism = 'launchd' | 'crontab' | 'schtasks';

export function getPlatformMechanism(): TickerMechanism {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'win32') return 'schtasks';
  return 'crontab';
}

// --- launchd (macOS) ---------------------------------------------------

// launchd agents and cron jobs do NOT inherit the user's shell PATH — they
// get a bare /usr/bin:/bin(:...), which excludes every place node actually
// gets installed (Homebrew's /opt/homebrew/bin, nvm's ~/.nvm/.../bin). The
// node that's running THIS install code knows where its own bin dir is
// (process.execPath), and npx ships in that same dir — so we bake that dir
// into the job's PATH at install time. Caught live: the very first real
// ticker-fire test on macOS would have died every tick with
// "env: npx: No such file or directory" without this.
function tickerPath(nodeBinDir: string): string {
  // /opt/homebrew/bin is included explicitly: on Apple Silicon,
  // process.execPath resolves through the symlink to a VERSIONED Cellar dir
  // (…/Cellar/node/26.4.0/bin) that disappears on `brew upgrade node` — the
  // stable symlink dir keeps the ticker alive across upgrades.
  return `${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
}

export function buildLaunchdPlist(
  pollIntervalSeconds: number = POLL_INTERVAL_SECONDS,
  nodeBinDir: string = path.dirname(process.execPath),
): string {
  const logPath = path.join(os.homedir(), 'Library', 'Logs', 'mcp-mailman-ticker.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npx</string>
    <string>-y</string>
    <string>${NPM_PACKAGE}</string>
    <string>send-scheduled</string>
    <string>--due</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${tickerPath(nodeBinDir)}</string>
  </dict>
  <key>StartInterval</key><integer>${pollIntervalSeconds}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
}

function launchdPlistPath(launchAgentsDir: string = path.join(os.homedir(), 'Library', 'LaunchAgents')): string {
  return path.join(launchAgentsDir, `${LAUNCHD_LABEL}.plist`);
}

async function isLaunchdInstalled(launchAgentsDir?: string): Promise<boolean> {
  try {
    await fs.access(launchdPlistPath(launchAgentsDir));
    return true;
  } catch {
    return false;
  }
}

async function installLaunchd(): Promise<void> {
  const plistPath = launchdPlistPath();
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, buildLaunchdPlist(), 'utf8');
  await execFileAsync('launchctl', ['load', '-w', plistPath]);
}

// --- crontab (Linux) -----------------------------------------------------

export function buildCronLine(pollIntervalMinutes = 3, nodeBinDir: string = path.dirname(process.execPath)): string {
  // Inline PATH= assignment — cron's default PATH is /usr/bin:/bin, which
  // misses nvm/Homebrew node installs (same trap as launchd above).
  return `*/${pollIntervalMinutes} * * * * PATH=${tickerPath(nodeBinDir)} npx -y ${NPM_PACKAGE} send-scheduled --due >> ~/.mcp-mailman-ticker.log 2>&1 ${CRON_MARKER}`;
}

export function isCronInstalled(currentCrontab: string): boolean {
  return currentCrontab.includes(CRON_MARKER);
}

/** Pure: appends/replaces the mailman ticker line, leaving every other crontab entry untouched. */
export function upsertCronLine(currentCrontab: string, cronLine: string = buildCronLine()): string {
  const lines = currentCrontab.split('\n').filter((l) => l.trim().length > 0 && !l.includes(CRON_MARKER));
  lines.push(cronLine);
  return `${lines.join('\n')}\n`;
}

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('crontab', ['-l']);
    return stdout;
  } catch {
    return ''; // no crontab yet for this user
  }
}

async function isCrontabInstalled(): Promise<boolean> {
  return isCronInstalled(await readCrontab());
}

async function installCrontab(): Promise<void> {
  const updated = upsertCronLine(await readCrontab());
  await new Promise<void>((resolve, reject) => {
    const child = spawn('crontab', ['-']);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`crontab exited with code ${code}: ${stderr}`));
    });
    child.stdin.write(updated);
    child.stdin.end();
  });
}

// --- Task Scheduler (Windows) --------------------------------------------

export function buildSchtasksCreateArgs(pollIntervalMinutes = 3): string[] {
  return [
    '/Create',
    '/TN', SCHTASKS_NAME,
    '/TR', `npx -y ${NPM_PACKAGE} send-scheduled --due`,
    '/SC', 'MINUTE',
    '/MO', String(pollIntervalMinutes),
    '/F',
  ];
}

async function isSchtasksInstalled(): Promise<boolean> {
  try {
    await execFileAsync('schtasks', ['/Query', '/TN', SCHTASKS_NAME]);
    return true;
  } catch {
    return false;
  }
}

async function installSchtasks(): Promise<void> {
  await execFileAsync('schtasks', buildSchtasksCreateArgs());
}

// --- Public, OS-dispatching API -------------------------------------------

export interface TickerStatus {
  mechanism: TickerMechanism;
  installed: boolean;
}

export async function getTickerStatus(): Promise<TickerStatus> {
  const mechanism = getPlatformMechanism();
  const installed =
    mechanism === 'launchd' ? await isLaunchdInstalled() : mechanism === 'crontab' ? await isCrontabInstalled() : await isSchtasksInstalled();
  return { mechanism, installed };
}

/** Idempotent — safe to call on every schedule_send; only actually registers once per machine. */
export async function installTickerIfNeeded(): Promise<TickerStatus> {
  const status = await getTickerStatus();
  if (status.installed) {
    return status;
  }
  if (status.mechanism === 'launchd') {
    await installLaunchd();
  } else if (status.mechanism === 'crontab') {
    await installCrontab();
  } else {
    await installSchtasks();
  }
  return { ...status, installed: true };
}
