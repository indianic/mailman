import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { getPackageName } from '../version.js';
import { describeActiveBackend } from '../config/keystore/index.js';

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

/**
 * Environment the ticker cannot rediscover for itself, captured at install time.
 *
 * cron gets no D-Bus session. On a Linux box whose keyring works interactively,
 * every scheduled send still died with `Cannot autolaunch D-Bus without X11
 * $DISPLAY`, because reaching the Secret Service needs `DBUS_SESSION_BUS_ADDRESS`
 * and `XDG_RUNTIME_DIR` — neither of which cron sets. Same class of problem as
 * the PATH assignment below, which was found the same way.
 *
 * `MCP_MAILMAN_CONFIG_DIR` matters for a different reason: without it a ticker
 * installed from a non-default profile would wake up reading the *default* config
 * dir, find no matching key, and fail every send.
 *
 * Secrets are deliberately excluded. `MAILMAN_MASTER_PASSPHRASE` would work here
 * and is exactly what must not happen automatically — mailman writing a passphrase
 * into a crontab on the user's behalf is not a decision it gets to make. `doctor`
 * reports that combination instead.
 */
export function tickerEnv(): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'MCP_MAILMAN_CONFIG_DIR']) {
    const value = process.env[name];
    if (value) captured[name] = value;
  }
  return captured;
}

/**
 * `VAR='value'` pairs safe to paste into a crontab line.
 *
 * Two escapes that matter: single quotes are closed/escaped/reopened the usual
 * way, and a literal `%` is escaped because cron treats it as "everything after
 * this is stdin" — an unescaped one silently truncates the command. D-Bus
 * addresses carry percent-encoded paths often enough for that to be real.
 */
export function cronEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([name, value]) => `${name}='${value.replace(/'/g, `'\\''`).replace(/%/g, '\\%')}'`)
    .join(' ');
}

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

/** plist string values are XML text: five characters have to be escaped. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildLaunchdPlist(
  pollIntervalSeconds: number = POLL_INTERVAL_SECONDS,
  nodeBinDir: string = path.dirname(process.execPath),
  env: Record<string, string> = tickerEnv(),
): string {
  const logPath = path.join(os.homedir(), 'Library', 'Logs', 'mcp-mailman-ticker.log');
  // macOS has no D-Bus, but MCP_MAILMAN_CONFIG_DIR and MAILMAN_KEYSTORE matter
  // here for the same reason they do under cron.
  const extraEnv = Object.entries(env)
    .map(([name, value]) => `\n    <key>${xmlEscape(name)}</key><string>${xmlEscape(value)}</string>`)
    .join('');
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
    <key>PATH</key><string>${tickerPath(nodeBinDir)}</string>${extraEnv}
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

async function installLaunchd(env: Record<string, string>): Promise<void> {
  const plistPath = launchdPlistPath();
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, buildLaunchdPlist(POLL_INTERVAL_SECONDS, path.dirname(process.execPath), env), 'utf8');
  await execFileAsync('launchctl', ['load', '-w', plistPath]);
}

// --- crontab (Linux) -----------------------------------------------------

export function buildCronLine(
  pollIntervalMinutes = 3,
  nodeBinDir: string = path.dirname(process.execPath),
  env: Record<string, string> = tickerEnv(),
): string {
  // Inline PATH= assignment — cron's default PATH is /usr/bin:/bin, which
  // misses nvm/Homebrew node installs (same trap as launchd above). The rest of
  // the environment follows for the reasons in tickerEnv().
  const prefix = [`PATH=${tickerPath(nodeBinDir)}`, cronEnvPrefix(env)].filter(Boolean).join(' ');
  return `*/${pollIntervalMinutes} * * * * ${prefix} npx -y ${NPM_PACKAGE} send-scheduled --due >> ~/.mcp-mailman-ticker.log 2>&1 ${CRON_MARKER}`;
}

/**
 * Does an installed crontab line carry a D-Bus session address?
 *
 * Exported for `doctor`: a ticker installed before this existed (or on a box that
 * had no session bus at install time) will keep failing every scheduled send at
 * 3am with nothing in the terminal to suggest why.
 */
export function cronLineHasDbus(currentCrontab: string): boolean {
  return currentCrontab
    .split('\n')
    .some((line) => line.includes(CRON_MARKER) && line.includes('DBUS_SESSION_BUS_ADDRESS='));
}

function managedCronLine(currentCrontab: string): string | undefined {
  return currentCrontab.split('\n').find((line) => line.includes(CRON_MARKER));
}

/** The poll interval from an installed line, so an upgrade preserves a hand-edited one. */
export function cronIntervalOf(currentCrontab: string, fallback = 3): number {
  const match = managedCronLine(currentCrontab)?.match(/^\*\/(\d+)\s/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Is an already-installed line missing environment we can now supply?
 *
 * Without this, the D-Bus fix would only ever reach people who had no ticker yet:
 * installTickerIfNeeded returns early when one exists, so every machine that hit
 * the original bug would keep its broken line forever, and `doctor` would print a
 * fix with no command behind it.
 *
 * Deliberately narrow — it only asks whether names we intend to set are absent, so
 * it can't fight a user who edited the schedule or the log path.
 */
export function cronLineNeedsEnvUpgrade(currentCrontab: string, env: Record<string, string>): boolean {
  const line = managedCronLine(currentCrontab);
  if (!line) return false;
  return Object.keys(env).some((name) => !line.includes(`${name}=`));
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

// (No isCrontabInstalled helper: getTickerStatus reads the crontab once and
// derives both "installed" and "does the line carry a session bus" from it.)

async function installCrontab(env: Record<string, string>): Promise<void> {
  const current = await readCrontab();
  // Preserve a hand-edited interval when this is an upgrade rather than a first
  // install — upsertCronLine replaces the managed line wholesale.
  const line = buildCronLine(cronIntervalOf(current), path.dirname(process.execPath), env);
  const updated = upsertCronLine(current, line);
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
  /**
   * crontab only: whether the installed line carries a D-Bus session address.
   * Undefined on other mechanisms and when nothing is installed. `doctor` uses it
   * — a ticker installed before that env was written keeps failing every
   * scheduled send with nothing in the terminal to explain why.
   */
  hasDbusEnv?: boolean;
}

export async function getTickerStatus(): Promise<TickerStatus> {
  const mechanism = getPlatformMechanism();
  if (mechanism === 'crontab') {
    const crontab = await readCrontab();
    const installed = isCronInstalled(crontab);
    return { mechanism, installed, hasDbusEnv: installed ? cronLineHasDbus(crontab) : undefined };
  }
  const installed = mechanism === 'launchd' ? await isLaunchdInstalled() : await isSchtasksInstalled();
  return { mechanism, installed };
}

/** Idempotent — safe to call on every schedule_send; only actually registers once per machine. */
export async function installTickerIfNeeded(): Promise<TickerStatus> {
  const status = await getTickerStatus();

  // The active keystore is pinned into the job's environment so the ticker
  // doesn't re-derive it from a probe that behaves differently without a session
  // — a cron process would find no reachable Secret Service and, without this,
  // resolve differently from the process that installed it.
  const env: Record<string, string> = { ...tickerEnv(), MAILMAN_KEYSTORE: (await describeActiveBackend()).name };

  if (status.installed) {
    // Self-heal a line installed before this environment was written. Every box
    // that hit the original "Cannot autolaunch D-Bus" bug already has a ticker,
    // so an early return here would mean the fix never reached any of them.
    if (status.mechanism === 'crontab' && cronLineNeedsEnvUpgrade(await readCrontab(), env)) {
      await installCrontab(env);
      return { ...status, hasDbusEnv: Boolean(env.DBUS_SESSION_BUS_ADDRESS) };
    }
    return status;
  }

  if (status.mechanism === 'launchd') {
    await installLaunchd(env);
  } else if (status.mechanism === 'crontab') {
    await installCrontab(env);
  } else {
    // Windows Task Scheduler's /TR takes a bare command with no environment
    // block, so there is nothing equivalent to inline here. Not a gap in
    // practice: Windows has no D-Bus, and the Credential Manager is reachable
    // from a scheduled task running as the same user. A non-default
    // MCP_MAILMAN_CONFIG_DIR is not carried through on Windows — see
    // docs/HEADLESS-KEYSTORE.md.
    await installSchtasks();
  }
  return { ...status, installed: true };
}
