import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { getDraft, markScheduled } from '../drafts.js';
import { createScheduledEntry } from '../scheduler/store.js';
import { installTickerIfNeeded } from '../scheduler/ticker-install.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  draftId: z.string(),
  sendAt: z.string(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const { draftId, sendAt } = parsed.data;

  const draft = getDraft(draftId);
  if (!draft) {
    return toolError(
      ErrorCodes.DRAFT_NOT_FOUND,
      `No such draft: ${draftId} — drafts are in-memory and expire; call draft_email again to create a new one.`,
    );
  }
  // An already-sent draft has its own code. Reporting it as DRAFT_EXPIRED
  // (which it did) tells a model the wrong thing: expiry is recoverable by
  // re-drafting the same message, whereas "already sent" means the mail is
  // gone and scheduling it again would send it twice.
  if (draft.state === 'sent') {
    return toolError(
      ErrorCodes.DRAFT_ALREADY_SENT,
      'This draft was already sent — call draft_email again if you want to schedule a new message.',
    );
  }
  if (draft.state !== 'pending') {
    const reason = draft.state === 'scheduled' ? 'already scheduled' : draft.state;
    return toolError(ErrorCodes.DRAFT_EXPIRED, `This draft is ${reason} — call draft_email again.`);
  }

  const entry = await createScheduledEntry({
    account: draft.account,
    sendAt,
    content: {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      bodyType: draft.bodyType,
      attachments: draft.rawAttachments,
      recursive: draft.recursive,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
    },
  });

  // Nothing is sent by this call — the ticker just needs to exist so a
  // future tick can fire this entry once mailman itself isn't running.
  await installTickerIfNeeded();
  markScheduled(draftId);

  return toolResponse({ scheduledId: entry.scheduledId, sendAt: entry.sendAt, status: entry.status });
}

export const scheduleSendTool: Tool = {
  definition: {
    name: 'schedule_send',
    description:
      'Confirm a draft for future dispatch instead of immediate sending. Persists to scheduled.json and installs the recurring OS ticker job if this machine doesn\'t have one yet. Must be called before the draft\'s TTL expires.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: 'The draftId returned by draft_email' },
        sendAt: { type: 'string', description: 'Absolute ISO-8601 instant — resolve relative phrases before calling' },
      },
      required: ['draftId', 'sendAt'],
      additionalProperties: false,
    },
  },
  handler,
};
