import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const LAUNCHD_LABEL = 'com.mcp-mailman.ticker';
const CRON_MARKER = '# mcp-mailman-ticker';
const SCHTASKS_NAME = 'mcp-mailman-ticker';
const POLL_INTERVAL_SECONDS = 180; // within the 1-5 min range docs/PLAN.md specifies

export type TickerMechanism = 'launchd' | 'crontab' | 'schtasks';

export function getPlatformMechanism(): TickerMechanism {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'win32') return 'schtasks';
  return 'crontab';
}

// --- launchd (macOS) ---------------------------------------------------

export function buildLaunchdPlist(pollIntervalSeconds: number = POLL_INTERVAL_SECONDS): string {
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
    <string>mcp-mailman</string>
    <string>send-scheduled</string>
    <string>--due</string>
  </array>
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

export function buildCronLine(pollIntervalMinutes = 3): string {
  return `*/${pollIntervalMinutes} * * * * npx -y mcp-mailman send-scheduled --due >> ~/.mcp-mailman-ticker.log 2>&1 ${CRON_MARKER}`;
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
    '/TR', 'npx -y mcp-mailman send-scheduled --due',
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
