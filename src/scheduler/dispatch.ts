import { listScheduled, decryptContent, updateScheduledEntry } from './store.js';
import { resolveAccount } from '../accounts.js';
import { getProvider } from '../mail/get-provider.js';
import { resolveAttachments } from '../tools/resolve-attachments.js';
import { upsertRecipient } from '../contacts.js';
import { notifyDesktop, summarizeRecipients } from '../notify.js';
import { debugLog } from '../logging.js';
import type { ScheduledEntry } from '../config/schema.js';

export const MAX_ATTEMPTS = 5;

export function isDue(entry: ScheduledEntry, now: Date): boolean {
  return entry.status === 'pending' && new Date(entry.sendAt).getTime() <= now.getTime();
}

/** Pure bookkeeping: after this many attempts, stop retrying and mark it failed for good. */
export function nextStatusAfterFailure(attemptsSoFar: number, maxAttempts: number = MAX_ATTEMPTS): 'pending' | 'failed' {
  return attemptsSoFar >= maxAttempts ? 'failed' : 'pending';
}

export type DispatchOutcome = 'sent' | 'retry-pending' | 'failed';

/**
 * Attachments are resolved fresh here, from the raw paths/globs/dirs
 * stored in `content.attachments` — never snapshotted at schedule_send
 * time (see docs/PLAN.md's "Scheduled sends" section). A moved/deleted
 * file surfaces as a dispatch failure (retried like any other failure),
 * not a silently-incomplete send.
 */
export async function dispatchOne(entry: ScheduledEntry): Promise<DispatchOutcome> {
  try {
    const content = await decryptContent(entry);
    const account = await resolveAccount(entry.account);
    const provider = await getProvider(account);

    const resolved = await resolveAttachments(content.attachments, { recursive: content.recursive });
    if ('code' in resolved) {
      throw new Error(resolved.message);
    }
    if (resolved.exceedsLimit) {
      throw new Error(
        `Attachments exceed Gmail's ~25 MB limit (total ${resolved.totalSizeBytes} bytes across ${resolved.files.length} file(s))`,
      );
    }

    const { messageId } = await provider.send({
      to: content.to,
      cc: content.cc.length > 0 ? content.cc : undefined,
      bcc: content.bcc.length > 0 ? content.bcc : undefined,
      subject: content.subject,
      body: content.body,
      bodyType: content.bodyType,
      attachments: resolved.files.map((f) => ({ path: f.path, name: f.name, mimeType: f.mimeType })),
      fromDisplayName: account.displayName,
    });

    const sentAt = new Date().toISOString();
    await updateScheduledEntry(entry.scheduledId, (e) => ({
      ...e,
      status: 'sent',
      attempts: e.attempts + 1,
      result: { messageId, sentAt },
    }));

    // Opt-in native notification — especially useful here, since a scheduled
    // send fires unattended in the background ticker.
    void notifyDesktop('mailman — scheduled email sent', `To ${summarizeRecipients(content.to)} · ${content.subject}`);

    try {
      await Promise.all([...content.to, ...content.cc, ...content.bcc].map((email) => upsertRecipient(email)));
    } catch (err) {
      debugLog('scheduled send: recipient auto-upsert failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return 'sent';
  } catch (err) {
    const attempts = entry.attempts + 1;
    const lastError = err instanceof Error ? err.message : String(err);
    const status = nextStatusAfterFailure(attempts);
    await updateScheduledEntry(entry.scheduledId, (e) => ({ ...e, attempts, status, lastError }));
    return status === 'failed' ? 'failed' : 'retry-pending';
  }
}

export interface DispatchSummary {
  sent: number;
  failed: number;
  retryPending: number;
}

/** The ticker's actual dispatch target (`mailman send-scheduled --due`) — see docs/CLI.md. */
export async function dispatchDueEntries(now: Date = new Date()): Promise<DispatchSummary> {
  const entries = await listScheduled();
  const due = entries.filter((e) => isDue(e, now));

  const summary: DispatchSummary = { sent: 0, failed: 0, retryPending: 0 };
  for (const entry of due) {
    const outcome = await dispatchOne(entry);
    if (outcome === 'sent') summary.sent += 1;
    else if (outcome === 'failed') summary.failed += 1;
    else summary.retryPending += 1;
  }
  return summary;
}
