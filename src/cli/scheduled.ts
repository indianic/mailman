import { listScheduled, decryptContent } from '../scheduler/store.js';

/** `mcp-mailman scheduled list` — read-only mirror of the list_scheduled MCP tool. */
export async function runScheduledList(_args: string[]): Promise<void> {
  const entries = await listScheduled();
  if (entries.length === 0) {
    process.stdout.write('No scheduled sends.\n');
    return;
  }

  const rows = await Promise.all(
    entries.map(async (e) => {
      const content = await decryptContent(e);
      return {
        scheduledId: e.scheduledId,
        to: content.to.join(', '),
        subject: content.subject,
        sendAt: e.sendAt,
        status: e.status,
        attempts: e.attempts,
      };
    }),
  );
  console.table(rows);
}
