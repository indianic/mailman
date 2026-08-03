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

/**
 * Which keystore backend holds the master key (see config/keystore/). Holds no
 * key material — a scrypt salt is not a secret — so it belongs in the config dir
 * with everything else, and inherits MCP_MAILMAN_CONFIG_DIR isolation for free.
 */
export function getKeystorePath(): string {
  return path.join(getConfigDir(), 'keystore.json');
}

export function getScheduledPath(): string {
  return path.join(getConfigDir(), 'scheduled.json');
}

export function getActivityLogPath(): string {
  return path.join(getConfigDir(), 'activity.log');
}
