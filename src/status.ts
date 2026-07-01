import { listScheduled } from './scheduler/store.js';

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

/**
 * Shared data source for the `status` CLI command and the `get_status`
 * MCP tool — one function, two presentations. accounts/security/activity
 * are still Phase 0 placeholders (Phase 9 fills those in); pendingScheduled
 * is real as of Phase 8, since that's the phase that introduced it.
 */
export async function collectStatus(): Promise<StatusData> {
  const scheduled = await listScheduled();
  const pendingScheduled = scheduled.filter((e) => e.status === 'pending').length;

  return {
    accounts: [],
    security: {
      masterKeyFound: false,
      encrypted: false,
    },
    mcpRegistration: {
      registered: false,
    },
    activity: {
      sent: 0,
      read: 0,
      searched: 0,
      sinceHours: 24,
    },
    pendingScheduled,
  };
}
