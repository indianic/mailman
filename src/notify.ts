import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getConfigDir } from './config/paths.js';
import { getSettings } from './settings.js';
import { debugLog } from './logging.js';

const execFileAsync = promisify(execFile);

/**
 * Best-effort native desktop notification, opt-in via the
 * `desktopNotifications` setting (default off). Never throws and never blocks
 * the caller's result: the underlying OS tool is spawned and any failure —
 * setting disabled, missing tool, headless server with no D-Bus session —
 * simply results in no pop-up.
 *
 * This runs inside whichever process performs the send. For interactive
 * sends that is the MCP stdio server the AI tool launched (not the CLI), but
 * that server runs as the logged-in user, so it can still post to the user's
 * notification center. Recipient/subject text is passed as process argv or
 * environment (never interpolated into a script) so it can't inject into the
 * AppleScript/shell command.
 */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.desktopNotifications) return;
    await dispatch(title, body);
  } catch (err) {
    debugLog('desktop notification skipped', { message: err instanceof Error ? err.message : String(err) });
  }
}

async function dispatch(title: string, body: string): Promise<void> {
  if (process.platform === 'darwin') return notifyMac(title, body);

  if (process.platform === 'linux') {
    // libnotify. Absent on headless servers / no D-Bus session — that's the
    // expected graceful no-op.
    await execFileAsync('notify-send', [title, body]);
    return;
  }

  if (process.platform === 'win32') {
    // Built-in .NET balloon tip — no external PowerShell module required.
    // Title/body read from env, not string-interpolated, to avoid injection.
    const script =
      'Add-Type -AssemblyName System.Windows.Forms;' +
      'Add-Type -AssemblyName System.Drawing;' +
      '$n=New-Object System.Windows.Forms.NotifyIcon;' +
      '$n.Icon=[System.Drawing.SystemIcons]::Information;' +
      '$n.Visible=$true;' +
      '$n.ShowBalloonTip(5000,$env:MAILMAN_NOTIFY_TITLE,$env:MAILMAN_NOTIFY_BODY,[System.Windows.Forms.ToolTipIcon]::Info);' +
      'Start-Sleep -Seconds 6;$n.Dispose()';
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, MAILMAN_NOTIFY_TITLE: title, MAILMAN_NOTIFY_BODY: body },
    });
    return;
  }
  // Other platforms: no supported notifier — silent no-op.
}

// ─── macOS: branded notification via a generated app bundle ─────────────────
//
// `osascript` posts notifications under Script Editor's identity (its icon,
// its name) with no way to override either. macOS instead attributes a
// notification to the app *bundle* that posts it — so we generate a tiny
// `mailman.app` in the config dir (once, cached) whose sole job is to run
// `display notification`, brand it with our icon + name, and fire through it.
// Everything is best-effort: if the bundle can't be built we fall back to
// plain osascript (correct text, generic icon).

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

// The applet reads title/body from the environment (not argv/script text),
// so no user string is ever interpolated into AppleScript source.
const APPLESCRIPT_SRC = `on run
\tset t to system attribute "MAILMAN_NOTIFY_TITLE"
\tset b to system attribute "MAILMAN_NOTIFY_BODY"
\tdisplay notification b with title t
end run
`;

// Per-process memo: once we've resolved the bundle path (or failed), don't
// re-run osacompile/PlistBuddy on every subsequent send.
let macAppResolution: Promise<string | null> | undefined;

async function notifyMac(title: string, body: string): Promise<void> {
  const env = { ...process.env, MAILMAN_NOTIFY_TITLE: title, MAILMAN_NOTIFY_BODY: body };
  const app = await ensureMailmanApp();
  if (app) {
    await execFileAsync(path.join(app, 'Contents', 'MacOS', 'applet'), [], { env });
    return;
  }
  // Fallback: plain osascript — right text, Script Editor icon. argv-passed
  // so user text can't break out of the AppleScript source.
  await execFileAsync('osascript', [
    '-e',
    'on run argv',
    '-e',
    'display notification (item 1 of argv) with title (item 2 of argv)',
    '-e',
    'end run',
    body,
    title,
  ]);
}

function ensureMailmanApp(): Promise<string | null> {
  macAppResolution ??= buildMailmanApp();
  return macAppResolution;
}

async function buildMailmanApp(): Promise<string | null> {
  const appPath = path.join(getConfigDir(), 'mailman.app');
  const appletBin = path.join(appPath, 'Contents', 'MacOS', 'applet');
  if (existsSync(appletBin)) return appPath;

  try {
    mkdirSync(getConfigDir(), { recursive: true });
    // A prior partial build could leave a dir with no applet — osacompile
    // refuses to overwrite an existing output, so clear it first.
    rmSync(appPath, { recursive: true, force: true });

    const scriptPath = path.join(getConfigDir(), '.mailman-notify.applescript');
    writeFileSync(scriptPath, APPLESCRIPT_SRC);
    await execFileAsync('osacompile', ['-o', appPath, scriptPath]);
    rmSync(scriptPath, { force: true });

    // Brand the bundle: our icon (osacompile names the icon file "applet"),
    // display name, and a stable identifier so macOS remembers notification
    // permission across upgrades.
    const iconSrc = fileURLToPath(new URL('../assets/mailman.icns', import.meta.url));
    if (existsSync(iconSrc)) {
      copyFileSync(iconSrc, path.join(appPath, 'Contents', 'Resources', 'applet.icns'));
    }
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    await plistSet(plist, 'CFBundleName', 'mailman');
    await plistSet(plist, 'CFBundleIdentifier', 'in.indianic.mailman');

    // Refresh the icon/identity caches (both best-effort).
    await execFileAsync('touch', [appPath]).catch(() => {});
    await execFileAsync(LSREGISTER, ['-f', appPath]).catch(() => {});

    return existsSync(appletBin) ? appPath : null;
  } catch (err) {
    debugLog('mailman.app build failed — falling back to plain osascript', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function plistSet(plist: string, key: string, value: string): Promise<void> {
  // The key exists in osacompile's Info.plist, so Set works; Add is a guard
  // in case a future macOS omits it.
  try {
    await execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  } catch {
    await execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]).catch(() => {});
  }
}

/**
 * Human-readable recipient summary for a notification body: the first
 * address, plus "and N more" when there are others. Keeps the pop-up to one
 * short line regardless of how many recipients a send had.
 */
export function summarizeRecipients(recipients: string[]): string {
  const [first, ...rest] = recipients;
  if (!first) return 'recipient';
  return rest.length > 0 ? `${first} and ${rest.length} more` : first;
}
