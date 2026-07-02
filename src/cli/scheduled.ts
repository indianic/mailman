import { intro, outro } from '@clack/prompts';
import { listScheduled, decryptContent } from '../scheduler/store.js';
import { section, detail } from './tree.js';

/** `mailman scheduled list` — read-only mirror of the list_scheduled MCP tool. */
export async function runScheduledList(_args: string[]): Promise<void> {
  intro('mailman — scheduled');
  const entries = await listScheduled();
  if (entries.length === 0) {
    outro('No scheduled sends.');
    return;
  }

  section('scheduled');
  for (const e of entries) {
    const content = await decryptContent(e);
    detail(`${e.scheduledId}   ${content.to.join(', ')}   "${content.subject}"   ${e.sendAt}   ${e.status}   attempts: ${e.attempts}`);
  }
  outro(`${entries.length} scheduled send(s)`);
}
