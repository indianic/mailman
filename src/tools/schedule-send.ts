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
    return toolError(ErrorCodes.DRAFT_NOT_FOUND, `No such draft: ${draftId}`);
  }
  if (draft.state !== 'pending') {
    const reason = draft.state === 'sent' ? 'already sent' : draft.state === 'scheduled' ? 'already scheduled' : draft.state;
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
        draftId: { type: 'string' },
        sendAt: { type: 'string', description: 'Absolute ISO-8601 instant — resolve relative phrases before calling' },
      },
      required: ['draftId', 'sendAt'],
    },
  },
  handler,
};
