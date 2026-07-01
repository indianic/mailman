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
 * MCP tool — one function, two presentations. Placeholder/empty sections
 * here; each later phase fills in its own slice (accounts in Phase 5,
 * security in Phase 3, activity in Phase 3/9, pendingScheduled in Phase 8).
 */
export async function collectStatus(): Promise<StatusData> {
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
    pendingScheduled: 0,
  };
}
