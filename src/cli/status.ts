import { intro, outro } from '@clack/prompts';
import { collectStatus } from '../status.js';
import { section, check, detail } from './tree.js';

/**
 * Thin renderer over collectStatus() — the same data the `get_status` MCP
 * tool returns as plain JSON. This is the one place a host-specific pretty
 * tree render is appropriate, since it's a human reading a terminal
 * directly. See docs/PLAN.md's "CLI status output" section and
 * docs/SKILLS.md's "Terminal output convention" for the design this
 * follows.
 */
export async function runStatus(_args: string[]): Promise<void> {
  const data = await collectStatus();

  intro('mailman — status');

  section('accounts');
  if (data.accounts.length === 0) {
    detail('none configured — run `mailman init`');
  } else {
    for (const account of data.accounts) {
      const flags = [account.method, account.isDefault ? 'default' : null, `read: ${account.canRead ? 'yes' : 'no'}`]
        .filter(Boolean)
        .join('   ');
      detail(`${account.alias}   ${flags}`);
    }
  }

  section('security');
  check(data.security.masterKeyFound, data.security.masterKeyFound ? 'master key found' : 'master key not found');
  check(data.security.encrypted, `accounts.json ${data.security.encrypted ? 'encrypted (AES-256-GCM)' : 'not encrypted'}`);

  section('mcp registration');
  check(
    data.mcpRegistration.registered,
    data.mcpRegistration.registered ? 'claude cli registered (global)' : 'claude cli not registered — run `mailman register`',
  );

  section(`activity (last ${data.activity.sinceHours}h)`);
  detail(`sent: ${data.activity.sent}   read: ${data.activity.read}   searched: ${data.activity.searched}`);

  if (data.pendingScheduled > 0) {
    section('scheduled');
    detail(`pending: ${data.pendingScheduled}`);
  }

  outro('status');
}
