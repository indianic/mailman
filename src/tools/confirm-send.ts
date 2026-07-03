import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { NoMasterKeyError, KeyringUnavailableError } from '../config/keychain.js';
import { getDraft, markSent } from '../drafts.js';
import { getProvider } from '../mail/get-provider.js';
import { OAuth2AuthError, OAuth2RateLimitError } from '../auth/oauth2.js';
import { upsertRecipient } from '../contacts.js';
import { notifyDesktop, summarizeRecipients } from '../notify.js';
import { getSettings } from '../settings.js';
import { debugLog } from '../logging.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  draftId: z.string(),
  // Explicit confirmation gate. When settings.alwaysConfirm is on (default),
  // confirm_send refuses to send unless this is true — so a draft is never
  // dispatched without a deliberate, separate confirmation step.
  confirm: z.boolean().optional(),
});

/** The send is blocked when confirmation is required by settings but not given. */
export function confirmationRequired(alwaysConfirm: boolean, confirm: boolean | undefined): boolean {
  return alwaysConfirm && confirm !== true;
}

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { draftId } = parsed.data;

  const draft = getDraft(draftId);
  if (!draft) {
    return toolError(ErrorCodes.DRAFT_NOT_FOUND, `No such draft: ${draftId}`);
  }

  // Idempotent replay: a retried confirm_send after an ambiguous prior
  // response (timeout, dropped connection) returns the original result
  // instead of attempting to resend.
  if (draft.state === 'sent' && draft.result) {
    return toolResponse({ sent: true, messageId: draft.result.messageId, sentAt: draft.result.sentAt });
  }
  if (draft.state === 'expired') {
    return toolError(ErrorCodes.DRAFT_EXPIRED, 'This draft has expired — call draft_email again.');
  }
  if (draft.state === 'cancelled') {
    return toolError(ErrorCodes.DRAFT_EXPIRED, 'This draft was cancelled — call draft_email again.');
  }

  // Confirmation gate — enforced here, not left to the caller's discretion.
  // With alwaysConfirm on (default), the draft is NOT sent unless confirm:true
  // is passed. Show the user the draft_email preview, get their explicit "yes",
  // then call confirm_send again with confirm:true.
  const settings = await getSettings();
  if (confirmationRequired(settings.alwaysConfirm, parsed.data.confirm)) {
    return toolError(
      'CONFIRMATION_REQUIRED',
      'Not sent. alwaysConfirm is on: show the draft preview to the user, get their explicit approval, then call confirm_send again with confirm:true. (To disable this gate: mailman settings set alwaysConfirm false.)',
    );
  }

  let account;
  try {
    account = await resolveAccount(draft.account);
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }

  const outboundMessage = {
    to: draft.to,
    cc: draft.cc.length > 0 ? draft.cc : undefined,
    bcc: draft.bcc.length > 0 ? draft.bcc : undefined,
    subject: draft.subject,
    body: draft.body,
    bodyType: draft.bodyType,
    attachments: draft.attachments.map((a) => ({ path: a.path, name: a.name, mimeType: a.mimeType })),
    fromDisplayName: account.displayName,
  };

  let messageId: string;
  try {
    const provider = await getProvider(account);
    ({ messageId } = await provider.send(outboundMessage));
  } catch (err) {
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

  const sentAt = new Date().toISOString();
  markSent(draftId, { messageId, sentAt });

  // Opt-in native desktop notification (off by default). Fire-and-forget:
  // the mail already went out, so a notification hiccup must never affect
  // the response.
  void notifyDesktop('mailman — email sent', `To ${summarizeRecipients(draft.to)} · ${draft.subject}`);

  // Best-effort: the mail already went out, so a contacts-bookkeeping
  // failure shouldn't turn a successful send into an error response.
  try {
    const recipients = [...draft.to, ...draft.cc, ...draft.bcc];
    await Promise.all(recipients.map((email) => upsertRecipient(email)));
  } catch (err) {
    debugLog('recipient auto-upsert failed', { message: err instanceof Error ? err.message : String(err) });
  }

  return toolResponse({ sent: true, messageId, sentAt });
}

export const confirmSendTool: Tool = {
  definition: {
    name: 'confirm_send',
    description:
      'Dispatch the exact draft produced by draft_email — the only tool that causes mail to leave the machine. When alwaysConfirm is on (default), you MUST first show the user the draft_email preview, get their explicit approval, and only then call this with confirm:true; a call without confirm:true is refused and nothing is sent. Idempotent: re-calling with the same draftId after a successful send returns the original result.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
        confirm: {
          type: 'boolean',
          description: 'Set true ONLY after the user has explicitly approved this exact draft. Required to send while alwaysConfirm is on.',
        },
      },
      required: ['draftId'],
    },
  },
  handler,
};
