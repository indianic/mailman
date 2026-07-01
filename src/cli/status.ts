import { intro, outro, log } from '@clack/prompts';
import { collectStatus } from '../status.js';

/**
 * Thin renderer over collectStatus() — the same data the `get_status` MCP
 * tool returns as plain JSON. This is the one place a host-specific pretty
 * tree render is appropriate, since it's a human reading a terminal
 * directly. See docs/PLAN.md's "CLI status output" section.
 */
export async function runStatus(_args: string[]): Promise<void> {
  const data = await collectStatus();

  intro('mailman — status');

  log.step('accounts');
  if (data.accounts.length === 0) {
    log.message('none configured — run `mcp-mailman init`');
  } else {
    for (const account of data.accounts) {
      const flags = [account.method, account.isDefault ? 'default' : null, `read: ${account.canRead ? 'yes' : 'no'}`]
        .filter(Boolean)
        .join('   ');
      log.message(`${account.alias}   ${flags}`);
    }
  }

  log.step('security');
  log.message(`master key      ${data.security.masterKeyFound ? 'found' : 'not found'}`);
  log.message(`accounts.json    ${data.security.encrypted ? 'encrypted (AES-256-GCM)' : 'not encrypted'}`);

  log.step('mcp registration');
  log.message(`claude cli       ${data.mcpRegistration.registered ? 'registered (global)' : 'not registered'}`);

  log.step(`activity (last ${data.activity.sinceHours}h)`);
  log.message(`sent: ${data.activity.sent}   read: ${data.activity.read}   searched: ${data.activity.searched}`);

  if (data.pendingScheduled > 0) {
    log.step('scheduled');
    log.message(`pending: ${data.pendingScheduled}`);
  }

  outro('status');
}
