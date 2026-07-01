import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { resolveProviderOrError, mapProviderError } from './mail-helpers.js';
import { clampLimit } from '../mail/normalize.js';
import type { MailProvider, EmailSummary } from '../mail/provider.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  account: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export interface EmailWithAttachments extends EmailSummary {
  attachments?: Array<{ name: string; sizeBytes: number; mimeType: string }>;
}

export interface MailboxOverviewStats {
  sentCount: number;
  inboxCount: number;
  unreadCount: number;
  attachmentCount: number;
}

/** Best-effort — a read() failure on one message (e.g. it was deleted a moment ago) shouldn't blank the whole overview. */
export async function enrichWithAttachments(
  provider: Pick<MailProvider, 'read'>,
  items: EmailSummary[],
): Promise<EmailWithAttachments[]> {
  return Promise.all(
    items.map(async (item): Promise<EmailWithAttachments> => {
      if (!item.hasAttachments) {
        return item;
      }
      try {
        const detail = await provider.read(item.id);
        return { ...item, attachments: detail.attachments };
      } catch {
        return item;
      }
    }),
  );
}

export function computeMailboxStats(sent: EmailSummary[], inbox: EmailSummary[]): MailboxOverviewStats {
  return {
    sentCount: sent.length,
    inboxCount: inbox.length,
    unreadCount: inbox.filter((e) => e.isUnread).length,
    attachmentCount: [...sent, ...inbox].filter((e) => e.hasAttachments).length,
  };
}

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }

  const resolved = await resolveProviderOrError(parsed.data.account);
  if ('errorResponse' in resolved) {
    return resolved.errorResponse;
  }

  const limit = clampLimit(parsed.data.limit);

  try {
    const [sentPage, inboxPage] = await Promise.all([
      resolved.provider.list({ folder: 'sent', limit }),
      resolved.provider.list({ folder: 'inbox', limit }),
    ]);

    const [sent, inbox] = await Promise.all([
      enrichWithAttachments(resolved.provider, sentPage.items),
      enrichWithAttachments(resolved.provider, inboxPage.items),
    ]);

    return toolResponse({
      stats: computeMailboxStats(sent, inbox),
      sent,
      inbox,
    });
  } catch (err) {
    return mapProviderError(err);
  }
}

export const getMailboxOverviewTool: Tool = {
  definition: {
    name: 'get_mailbox_overview',
    description:
      'One-call snapshot of recent sent + inbox mail, with attachment name/size/type resolved for any message that has one (no attachment bytes downloaded). Returns structured JSON only — like every other mailman tool, rendering (a table, a colored dashboard, etc.) is Claude\'s job, not this tool\'s.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        limit: { type: 'number', description: 'Per-folder limit, defaults to 10, capped at 50' },
      },
    },
  },
  handler,
};
