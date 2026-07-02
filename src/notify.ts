import { execFile } from 'node:child_process';
import { getSettings } from './settings.js';
import { debugLog } from './logging.js';

/**
 * Best-effort native desktop notification, opt-in via the
 * `desktopNotifications` setting (default off). Never throws and never
 * blocks the caller: the underlying OS tool is spawned fire-and-forget and
 * every failure mode — setting disabled, missing `osascript`/`notify-send`,
 * a headless server with no D-Bus session — simply results in no pop-up.
 *
 * This runs inside whichever process performs the send. For interactive
 * sends that is the MCP stdio server the AI tool launched (not the CLI), but
 * that server runs as the logged-in user, so it can still post to the user's
 * notification center. Recipient/subject text is passed as process argv
 * (never interpolated into a script string) so it can't break out of, or
 * inject into, the AppleScript/shell command.
 */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.desktopNotifications) return;
    dispatch(title, body);
  } catch (err) {
    debugLog('desktop notification skipped', { message: err instanceof Error ? err.message : String(err) });
  }
}

function onSpawnDone(err: unknown): void {
  if (err) {
    debugLog('desktop notification failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

function dispatch(title: string, body: string): void {
  if (process.platform === 'darwin') {
    // `on run argv` receives title/body as arguments, so no user text ever
    // touches the AppleScript source — no escaping, no injection.
    execFile(
      'osascript',
      [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 1 of argv) with title (item 2 of argv)',
        '-e',
        'end run',
        body,
        title,
      ],
      onSpawnDone,
    );
    return;
  }

  if (process.platform === 'linux') {
    // libnotify. Absent on headless servers / no D-Bus session — that's the
    // expected graceful no-op, logged at debug only.
    execFile('notify-send', [title, body], onSpawnDone);
    return;
  }

  if (process.platform === 'win32') {
    // Built-in .NET balloon tip — no external PowerShell module required.
    // Title/body are read from env, not string-interpolated, to avoid
    // PowerShell injection.
    const script =
      'Add-Type -AssemblyName System.Windows.Forms;' +
      'Add-Type -AssemblyName System.Drawing;' +
      '$n=New-Object System.Windows.Forms.NotifyIcon;' +
      '$n.Icon=[System.Drawing.SystemIcons]::Information;' +
      '$n.Visible=$true;' +
      '$n.ShowBalloonTip(5000,$env:MAILMAN_NOTIFY_TITLE,$env:MAILMAN_NOTIFY_BODY,[System.Windows.Forms.ToolTipIcon]::Info);' +
      'Start-Sleep -Seconds 6;$n.Dispose()';
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, MAILMAN_NOTIFY_TITLE: title, MAILMAN_NOTIFY_BODY: body } },
      onSpawnDone,
    );
    return;
  }
  // Other platforms: no supported notifier — silent no-op.
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
