import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { NoMasterKeyError, KeyringUnavailableError } from '../config/keychain.js';
import { getDraft, markSent } from '../drafts.js';
import { getProvider } from '../mail/get-provider.js';
import { OAuth2AuthError, OAuth2RateLimitError } from '../auth/oauth2.js';
import { upsertRecipient } from '../contacts.js';
import { debugLog } from '../logging.js';
import type { Tool } from './types.js';

const InputSchema = z.object({ draftId: z.string() });

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
      'Dispatch the exact draft produced by draft_email. This is the only tool that actually causes mail to leave the machine — never call it without the user having seen and confirmed the draft_email preview first. Idempotent: calling it again with the same draftId after a successful send returns the original result.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
      },
      required: ['draftId'],
    },
  },
  handler,
};
