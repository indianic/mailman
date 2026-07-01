import os from 'node:os';
import path from 'node:path';

/**
 * Global, per-OS-user config directory. Never project-relative — resolved
 * from os.homedir()/process.env, never process.cwd(). See docs/PLAN.md's
 * "Global config" section.
 */
export function getConfigDir(): string {
  const override = process.env.MCP_MAILMAN_CONFIG_DIR;
  if (override) {
    return override;
  }

  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mcp-mailman');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'mcp-mailman');
  }
  return path.join(os.homedir(), '.config', 'mcp-mailman');
}

export function getAccountsPath(): string {
  return path.join(getConfigDir(), 'accounts.json');
}

export function getContactsPath(): string {
  return path.join(getConfigDir(), 'contacts.json');
}

export function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json');
}

export function getScheduledPath(): string {
  return path.join(getConfigDir(), 'scheduled.json');
}

export function getActivityLogPath(): string {
  return path.join(getConfigDir(), 'activity.log');
}
