import { resolveAccount } from '../accounts.js';
import { getProvider } from '../mail/get-provider.js';
import { resolveAttachments } from '../tools/resolve-attachments.js';
import { upsertRecipient } from '../contacts.js';
import { debugLog } from '../logging.js';
import { renderTemplate } from './render.js';
import { signatureInlineImages } from '../mail/compose.js';
import {
  decryptCampaignContent,
  eligibleRecipients,
  getCampaign,
  tallyRecipients,
  updateCampaign,
  updateRecipient,
} from './store.js';
import type { OutboundMessage } from '../mail/provider.js';
import type { CampaignEntry } from '../config/schema.js';

/** Cap on retries per recipient, across all runs. Exhausted → failed for good. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Gmail app-password accounts have burst limits, and a tripped account fails the *rest* of the run. */
export const DEFAULT_THROTTLE_PER_MINUTE = 20;

/**
 * Share of recipients that may fail before a run is abandoned wholesale.
 *
 * A systematically broken campaign — wrong credentials, a rate limit that has
 * already bitten — should not grind through 39 recipients producing 39
 * failures and 39 retry rows. The floor of 3 keeps a four-person campaign from
 * aborting over one bad address.
 */
export const DEFAULT_ABORT_THRESHOLD = 0.25;
const ABORT_FLOOR = 3;

export function abortLimit(total: number, threshold = DEFAULT_ABORT_THRESHOLD): number {
  return Math.max(ABORT_FLOOR, Math.ceil(total * threshold));
}

export interface CampaignRunResult {
  campaignId: string;
  status: CampaignEntry['status'];
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  total: number;
  attempted: number;
  failures: Array<{ email: string; error: string; attempts: number; retriable: boolean }>;
  /** True when recipients remain and another confirm_campaign would pick them up. */
  resumable: boolean;
  abortReason?: string;
  /** Whose message carried the ccFirstOnly list. */
  ccAppliedTo?: string;
  /** Whose message carried the bccFirstOnly list — the same one, when both are set. */
  bccAppliedTo?: string;
}

export interface DispatchDeps {
  /** Overridden in tests so the send loop is exercised without a network. */
  send?: (message: OutboundMessage) => Promise<{ messageId: string }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Send one campaign's outstanding recipients.
 *
 * Three properties matter more than anything else here, and they are all
 * consequences of writing state to disk after every single message:
 *
 *  - **Exactly once.** A recipient is marked `sent` only after the transport
 *    hands back a message id. Marking before the send would turn a mid-run
 *    crash into silent non-delivery; marking a batch at the end would turn it
 *    into duplicates. Neither is recoverable after the fact.
 *  - **Resume, not restart.** Terminal recipients are never eligible again
 *    (see eligibleRecipients), so re-calling this after a crash, a cancel or a
 *    runtime cut-off picks up exactly where it stopped.
 *  - **One attempt per recipient per run.** Retries happen by calling this
 *    again, not by looping inside it. A transport that is failing for
 *    structural reasons gets a pause and an explicit second decision rather
 *    than three rapid-fire attempts against an account that may already be
 *    rate-limited.
 *
 * The campaign row is re-read before every send, so a cancel_campaign issued
 * from another tool call stops the run at the next recipient instead of after
 * the last one.
 */
export async function dispatchCampaign(
  campaignId: string,
  options: { maxRuntimeMs?: number } & DispatchDeps = {},
): Promise<CampaignRunResult> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const maxRuntimeMs = options.maxRuntimeMs ?? 10 * 60_000;

  let entry = await getCampaign(campaignId);
  if (!entry) throw new Error(`No such campaign: ${campaignId}`);

  const content = await decryptCampaignContent(entry);
  const account = await resolveAccount(entry.account);
  const provider = options.send ? undefined : await getProvider(account);
  const send = options.send ?? ((message: OutboundMessage) => provider!.send(message));

  // Resolved once per run, fresh from disk — the same files go to everyone
  // (per-recipient attachments are explicitly out of scope). A bad path is a
  // whole-run failure rather than 39 identical per-recipient errors.
  const resolved = await resolveAttachments(content.attachments, { recursive: content.recursive });
  if ('code' in resolved) {
    throw new Error(resolved.message);
  }
  if (resolved.exceedsLimit) {
    throw new Error(
      `Attachments exceed Gmail's ~25 MB limit (total ${resolved.totalSizeBytes} bytes across ${resolved.files.length} file(s))`,
    );
  }
  const attachments = resolved.files.map((f) => ({ path: f.path, name: f.name, mimeType: f.mimeType }));

  const intervalMs = Math.ceil(60_000 / entry.throttlePerMinute);
  const limit = abortLimit(entry.recipients.length);
  const failures: CampaignRunResult['failures'] = [];
  let failuresThisRun = 0;
  let attempted = 0;
  let abortReason: string | undefined;
  let lastSendAt = 0;

  for (const target of eligibleRecipients(entry)) {
    // Re-read rather than trusting the snapshot: cancel_campaign may have run
    // between messages, and a resumed campaign must not resurrect it.
    const current = await getCampaign(campaignId);
    if (!current || current.status === 'cancelled') {
      abortReason = abortReason ?? 'cancelled while sending';
      break;
    }
    entry = current;
    const row = entry.recipients.find((r) => r.seq === target.seq);
    if (!row || row.status === 'sent' || row.status === 'skipped') continue;

    if (now() - startedAt >= maxRuntimeMs) break;

    // Pace against the *previous* send, so resuming a campaign doesn't open
    // with a needless wait and a slow transport doesn't stack delay on delay.
    if (lastSendAt > 0) {
      const wait = intervalMs - (now() - lastSendAt);
      if (wait > 0) await sleep(wait);
    }

    const recipient = content.recipients[target.seq];
    const subject = renderTemplate(content.subjectTemplate, recipient.vars, 'text').text;
    const body = renderTemplate(content.bodyTemplate, recipient.vars, content.bodyType).text;

    // The Cc/Bcc ride with the first message that actually goes out — not the
    // first one attempted. Copying leadership on all N is the failure this
    // exists to make impossible; handing the list to a message that then fails
    // would be the quieter version of the same bug.
    //
    // One flag covers both, so a campaign with each set puts them on the same
    // message rather than on the first two.
    const bccFirstOnly = content.bccFirstOnly ?? [];
    const carriesCc =
      (content.ccFirstOnly.length > 0 || bccFirstOnly.length > 0) && entry.ccAppliedToSeq === undefined;

    attempted += 1;
    lastSendAt = now();

    try {
      const { messageId } = await send({
        to: [recipient.email],
        cc: carriesCc && content.ccFirstOnly.length > 0 ? content.ccFirstOnly : undefined,
        bcc: carriesCc && bccFirstOnly.length > 0 ? bccFirstOnly : undefined,
        subject,
        body,
        bodyType: content.bodyType,
        attachments,
        fromDisplayName: account.displayName,
        inlineImages: signatureInlineImages(account, body, content.bodyType),
      });

      const sentAt = new Date().toISOString();
      await updateCampaign(campaignId, (c) => ({
        ...c,
        ccAppliedToSeq: carriesCc ? target.seq : c.ccAppliedToSeq,
        recipients: c.recipients.map((r) =>
          r.seq === target.seq
            ? { ...r, status: 'sent' as const, attempts: r.attempts + 1, messageId, sentAt, error: undefined }
            : r,
        ),
      }));

      // Best-effort bookkeeping — the mail is already gone, so a contacts
      // write failing must not turn a delivered message into a reported one.
      try {
        await upsertRecipient(recipient.email, recipient.vars.name);
      } catch (err) {
        debugLog('campaign: recipient auto-upsert failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      await updateRecipient(campaignId, target.seq, (r) => ({ ...r, status: 'failed', attempts, error }));
      failures.push({ email: recipient.email, error, attempts, retriable: attempts < entry.maxAttempts });
      failuresThisRun += 1;

      if (failuresThisRun >= limit) {
        abortReason =
          `Aborted after ${failuresThisRun} failures out of ${attempted} attempted — this looks systematic ` +
          `(bad credentials or a rate limit), not ${failuresThisRun} unlucky addresses. ` +
          'Fix the cause, then call confirm_campaign again to resume; nothing already sent will be re-sent.';
        break;
      }
    }
  }

  // Re-read once more: the loop wrote through updateCampaign, so the freshest
  // tallies are on disk, not in the local `entry`.
  const finalEntry = (await getCampaign(campaignId))!;
  const totals = tallyRecipients(finalEntry.recipients);
  const remaining = eligibleRecipients(finalEntry).length;

  let status = finalEntry.status;
  if (finalEntry.status !== 'cancelled') {
    if (abortReason) status = 'failed';
    else if (remaining === 0) status = 'sent';
    else status = 'sending';
  }

  const updated = await updateCampaign(campaignId, (c) => ({
    ...c,
    status,
    ...(abortReason && c.status !== 'cancelled' ? { abortReason } : {}),
  }));

  const ccSeq = updated?.ccAppliedToSeq;

  return {
    campaignId,
    status,
    ...totals,
    attempted,
    failures,
    resumable: remaining > 0 && status !== 'cancelled',
    ...(abortReason && status === 'failed' ? { abortReason } : {}),
    ...(ccSeq !== undefined && content.ccFirstOnly.length > 0
      ? { ccAppliedTo: content.recipients[ccSeq]?.email }
      : {}),
    ...(ccSeq !== undefined && (content.bccFirstOnly ?? []).length > 0
      ? { bccAppliedTo: content.recipients[ccSeq]?.email }
      : {}),
  };
}
