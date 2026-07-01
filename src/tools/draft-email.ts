import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { getSettings } from '../settings.js';
import { createDraft, type DraftAttachment } from '../drafts.js';
import { guessMimeType } from '../mail/mime.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  body: z.string(),
  bodyType: z.enum(['text', 'html']).optional(),
  attachments: z.array(z.string()).optional(),
  account: z.string().optional(),
});

// Explicit paths only for now — glob/directory expansion and size caps
// are Phase 2's resolve-attachments.ts. This just stats each given path.
async function resolveExplicitAttachments(paths: string[]): Promise<DraftAttachment[] | { notFound: string }> {
  const attachments: DraftAttachment[] = [];
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return { notFound: filePath };
      }
      attachments.push({
        path: filePath,
        name: path.basename(filePath),
        sizeBytes: stat.size,
        mimeType: guessMimeType(filePath),
      });
    } catch {
      return { notFound: filePath };
    }
  }
  return attachments;
}

function defaultSubject(attachments: DraftAttachment[]): string {
  return attachments.length > 0 ? `Files attached: ${attachments.map((a) => a.name).join(', ')}` : 'Files attached';
}

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const input = parsed.data;

  let account;
  try {
    account = await resolveAccount(input.account);
  } catch (err) {
    if (err instanceof AccountResolutionError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }

  let attachments: DraftAttachment[] = [];
  if (input.attachments && input.attachments.length > 0) {
    const result = await resolveExplicitAttachments(input.attachments);
    if ('notFound' in result) {
      return toolError(ErrorCodes.ATTACHMENT_NOT_FOUND, `Attachment not found or unreadable: ${result.notFound}`);
    }
    attachments = result;
  }

  const to = Array.isArray(input.to) ? input.to : [input.to];
  const subject = input.subject ?? defaultSubject(attachments);
  const settings = await getSettings();

  const draft = createDraft({
    account: account.alias,
    to,
    cc: input.cc,
    bcc: input.bcc,
    subject,
    body: input.body,
    bodyType: input.bodyType,
    attachments,
    ttlMinutes: settings.draftTtlMinutes,
  });

  return toolResponse({
    draftId: draft.draftId,
    expiresAt: draft.expiresAt,
    preview: {
      from: account.email,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyPreview: draft.body.slice(0, 500),
      attachments: draft.attachments.map((a) => ({ name: a.name, sizeBytes: a.sizeBytes, mimeType: a.mimeType })),
    },
    next_steps: ['Show this preview to the user and get explicit confirmation before calling confirm_send.'],
  });
}

export const draftEmailTool: Tool = {
  definition: {
    name: 'draft_email',
    description:
      'Resolve recipients/attachments/account and return a preview. Does not send — the only tool that sends is confirm_send, and it must only be called after the user has seen this preview and explicitly confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { description: 'Recipient email address, or an array of addresses' },
        cc: { type: 'array', items: { type: 'string' } },
        bcc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string', description: 'Optional — a minimal default is filled in if omitted' },
        body: { type: 'string' },
        bodyType: { type: 'string', enum: ['text', 'html'] },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Explicit file paths' },
        account: { type: 'string', description: 'Account alias; omit to use the only/default configured account' },
      },
      required: ['to', 'body'],
    },
  },
  handler,
};
