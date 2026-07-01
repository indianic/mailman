import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listAccounts, getDefaultAlias } from './accounts.js';
import { getMasterKeyOrThrow } from './config/keychain.js';
import { summarizeActivity } from './audit.js';
import { listScheduled } from './scheduler/store.js';

const execFileAsync = promisify(execFile);

export interface StatusAccount {
  alias: string;
  method: 'app-password' | 'oauth2';
  isDefault: boolean;
  canRead: boolean;
}

export interface StatusData {
  accounts: StatusAccount[];
  security: {
    masterKeyFound: boolean;
    encrypted: boolean;
  };
  mcpRegistration: {
    registered: boolean;
  };
  activity: {
    sent: number;
    read: number;
    searched: number;
    sinceHours: number;
  };
  pendingScheduled: number;
}

async function checkMasterKeyFound(): Promise<boolean> {
  try {
    await getMasterKeyOrThrow();
    return true;
  } catch {
    return false;
  }
}

// Best-effort — `claude mcp list`'s exact output format isn't a stable
// contract, and the `claude` binary may not even be on PATH in every
// environment mailman itself runs in. A failure here just means
// "registered: false," never a thrown error.
async function checkMcpRegistration(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('claude', ['mcp', 'list']);
    return /mailman/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Shared data source for the `status` CLI command and the `get_status`
 * MCP tool — one function, two presentations.
 */
export async function collectStatus(): Promise<StatusData> {
  const [accounts, defaultAlias, masterKeyFound, registered, activity, scheduled] = await Promise.all([
    listAccounts(),
    getDefaultAlias(),
    checkMasterKeyFound(),
    checkMcpRegistration(),
    summarizeActivity(),
    listScheduled(),
  ]);

  return {
    accounts: accounts.map((a) => ({
      alias: a.alias,
      method: a.method,
      isDefault: a.alias === defaultAlias,
      canRead: true,
    })),
    security: {
      masterKeyFound,
      // Every account's credentials are encrypted unconditionally by
      // configureAccount() — this isn't a per-account state to check.
      encrypted: true,
    },
    mcpRegistration: {
      registered,
    },
    activity,
    pendingScheduled: scheduled.filter((e) => e.status === 'pending').length,
  };
}
