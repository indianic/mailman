import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { AccountResolutionError } from '../accounts.js';
import { NoMasterKeyError, KeyringUnavailableError } from '../config/keychain.js';
import { OAuth2AuthError, OAuth2RateLimitError } from '../auth/oauth2.js';
import { getSettings } from '../settings.js';
import { notifyDesktop } from '../notify.js';
import { confirmationRequired } from './confirm-send.js';
import { getCampaign, tallyRecipients, updateCampaign } from '../campaigns/store.js';
import { dispatchCampaign } from '../campaigns/dispatch.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  campaignId: z.string(),
  confirm: z.boolean().optional(),
  /**
   * Bound on how long one call sends for. Whatever is left stays `pending` and
   * the next confirm_campaign picks it up — the same resume path a crash uses,
   * so this costs no extra machinery and keeps a large campaign from holding a
   * tool call open past the host's patience.
   */
  maxRuntimeSeconds: z.number().int().positive().max(3600).optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { campaignId } = parsed.data;

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return toolError(ErrorCodes.CAMPAIGN_NOT_FOUND, `No such campaign: ${campaignId} — call draft_campaign to create one.`);
  }
  if (campaign.status === 'cancelled') {
    return toolError(ErrorCodes.CAMPAIGN_CANCELLED, 'This campaign was cancelled — call draft_campaign again to start a new one.');
  }

  const totals = tallyRecipients(campaign.recipients);

  // Idempotent replay, exactly as confirm_send does: a retried call after an
  // ambiguous response reports the finished run instead of sending it twice.
  if (campaign.status === 'sent' && totals.pending === 0) {
    return toolResponse({ campaignId, status: 'sent', ...totals, alreadyComplete: true });
  }

  const settings = await getSettings();
  if (confirmationRequired(settings.alwaysConfirm, parsed.data.confirm)) {
    return toolError(
      ErrorCodes.CONFIRMATION_REQUIRED,
      `Nothing sent. alwaysConfirm is on, and this one call dispatches ${totals.total} separate emails: show the ` +
        'draft_campaign samples and warnings to the user, get their explicit approval, then call confirm_campaign ' +
        'again with confirm:true. (To disable this gate: mailman settings set alwaysConfirm false.)',
    );
  }

  if (campaign.status === 'draft') {
    await updateCampaign(campaignId, (c) => ({ ...c, status: 'sending' }));
  }

  let result;
  try {
    result = await dispatchCampaign(campaignId, {
      maxRuntimeMs: (parsed.data.maxRuntimeSeconds ?? 600) * 1000,
    });
  } catch (err) {
    // Whole-run failures — a bad account, an unreadable attachment, no master
    // key. Nothing was sent, so the campaign stays resumable once fixed.
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    if (err instanceof NoMasterKeyError || err instanceof KeyringUnavailableError) {
      return toolError(ErrorCodes.NO_MASTER_KEY, err.message);
    }
    if (err instanceof OAuth2AuthError) {
      return toolError(ErrorCodes.AUTH_EXPIRED, err.message);
    }
    if (err instanceof OAuth2RateLimitError) {
      return toolError(ErrorCodes.RATE_LIMITED, err.message, { retryAfterMs: err.retryAfterMs });
    }
    throw err;
  }

  // One notification for the campaign, not one per message — 39 toasts is a
  // punishment, not a notification.
  void notifyDesktop(
    'mailman — campaign finished',
    `${result.sent} sent, ${result.failed} failed of ${result.total}`,
  );

  const nextSteps: string[] = [];
  if (result.failures.length > 0) {
    nextSteps.push(
      'Report the failures verbatim — do not round them off to "mostly sent". Re-calling confirm_campaign retries ' +
        'only the retriable ones; nothing already sent is re-sent.',
    );
  }
  if (result.resumable) {
    nextSteps.push(`${result.pending} recipient(s) still pending — call confirm_campaign again to continue.`);
  }

  return toolResponse({
    campaignId: result.campaignId,
    status: result.status,
    total: result.total,
    sent: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    pending: result.pending,
    attemptedThisRun: result.attempted,
    ...(result.ccAppliedTo ? { ccAppliedTo: result.ccAppliedTo } : {}),
    ...(result.bccAppliedTo ? { bccAppliedTo: result.bccAppliedTo } : {}),
    ...(result.abortReason ? { abortReason: result.abortReason } : {}),
    failures: result.failures,
    resumable: result.resumable,
    ...(nextSteps.length > 0 ? { next_steps: nextSteps } : {}),
  });
}

export const confirmCampaignTool: Tool = {
  definition: {
    name: 'confirm_campaign',
    description:
      'Send a campaign prepared by draft_campaign — the only tool that dispatches a merge, and it sends every recipient in one approval. You MUST first show the user the draft_campaign samples and warnings and get their explicit approval, then call this with confirm:true. Safe to re-call: it resumes a partially-sent campaign and never re-sends a recipient already marked sent.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaignId returned by draft_campaign' },
        confirm: {
          type: 'boolean',
          description: 'Set true ONLY after the user has approved this exact campaign preview. Required while alwaysConfirm is on.',
        },
        maxRuntimeSeconds: {
          type: 'number',
          description: 'Cap this call at N seconds (default 600). Anything left stays pending for the next confirm_campaign call.',
        },
      },
      required: ['campaignId'],
      additionalProperties: false,
    },
  },
  handler,
};
