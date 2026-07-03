import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { getSettings } from '../settings.js';
import { createDraft, type DraftAttachment } from '../drafts.js';
import { resolveAttachments } from './resolve-attachments.js';
import { formatFromAddress, appendSignature, wrapPolished } from '../mail/compose.js';
import { getTemplate, applySubjectPrefix, buildForwardedBody } from '../mail/templates.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().optional(),
  body: z.string(),
  bodyType: z.enum(['text', 'html']).optional(),
  attachments: z.array(z.string()).optional(),
  recursive: z.boolean().optional(),
  account: z.string().optional(),
  // Message template — a subject prefix + structural hint (see list_templates).
  template: z.string().optional(),
  // Per-call override of the HTML visual treatment (settings.emailTheme).
  theme: z.enum(['plain', 'polished']).optional(),
  // Fields for the mechanical 'fwd'/'reply' templates.
  forwardedFrom: z.string().optional(),
  forwardedDate: z.string().optional(),
  forwardedSubject: z.string().optional(),
  forwardedTo: z.string().optional(),
  forwardedBody: z.string().optional(),
});

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

  const resolved = await resolveAttachments(input.attachments, { recursive: input.recursive });
  if ('code' in resolved) {
    return toolError(resolved.code, resolved.message);
  }
  if (resolved.exceedsLimit) {
    return toolError(
      ErrorCodes.ATTACHMENT_TOO_LARGE,
      `Attachments exceed Gmail's ~25 MB limit (total ${resolved.totalSizeBytes} bytes across ${resolved.files.length} file(s))`,
    );
  }

  // Resolve the template up front so an unknown key fails fast.
  const template = input.template ? getTemplate(input.template) : undefined;
  if (input.template && !template) {
    return toolError('INVALID_INPUT', `Unknown template "${input.template}". Call list_templates to see available keys.`);
  }

  const to = Array.isArray(input.to) ? input.to : [input.to];
  const settings = await getSettings();
  const bodyType = input.bodyType ?? settings.defaultBodyType;

  // Subject: apply the template prefix (de-duplicated — never "FYI: FYI:"),
  // falling back to a minimal default when nothing usable is left.
  let subject = template
    ? applySubjectPrefix(template.subjectPrefix, input.subject ?? '')
    : (input.subject ?? '').trim();
  if (!subject) subject = defaultSubject(resolved.files);

  // Body: mechanical templates (fwd/reply) build a real quoted block.
  let composed = input.body;
  if (
    template?.kind === 'mechanical' &&
    (input.forwardedBody || input.forwardedFrom || input.forwardedSubject)
  ) {
    composed = buildForwardedBody(
      input.body,
      {
        forwardedFrom: input.forwardedFrom,
        forwardedDate: input.forwardedDate,
        forwardedSubject: input.forwardedSubject,
        forwardedTo: input.forwardedTo,
        forwardedBody: input.forwardedBody,
      },
      bodyType,
    );
  }

  let body = appendSignature(composed, account.signature, bodyType);
  const signatureAppended = Boolean(account.signature) && body !== composed;

  // Polished theme — opt-in, HTML only. Wraps the whole body in a clean shell.
  const theme = input.theme ?? settings.emailTheme;
  const polished = bodyType === 'html' && theme === 'polished';
  if (polished) body = wrapPolished(body);

  const draft = createDraft({
    account: account.alias,
    to,
    cc: input.cc,
    bcc: input.bcc,
    subject,
    body,
    bodyType,
    attachments: resolved.files,
    rawAttachments: input.attachments,
    recursive: input.recursive,
    ttlMinutes: settings.draftTtlMinutes,
  });

  return toolResponse({
    draftId: draft.draftId,
    expiresAt: draft.expiresAt,
    preview: {
      from: formatFromAddress(account.email, account.displayName),
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      // Preview the composed body only (pre-signature), truncated. The
      // account signature is appended to the actual send but deliberately
      // NOT echoed here — re-emitting the full signature HTML on every draft
      // is pure token overhead; `signatureAppended` flags it instead.
      bodyPreview: input.body.length > 280 ? `${input.body.slice(0, 280)}…` : input.body,
      ...(signatureAppended ? { signatureAppended: true } : {}),
      ...(template ? { template: template.key } : {}),
      ...(polished ? { theme: 'polished' } : {}),
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
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit file paths, glob patterns, or directories',
        },
        recursive: { type: 'boolean', description: 'Expand directory attachments recursively (default: top-level only)' },
        account: { type: 'string', description: 'Account alias; omit to use the only/default configured account' },
        template: {
          type: 'string',
          description:
            'Optional message template key (see list_templates). Applies a subject prefix (de-duplicated) and a structural hint you should follow when composing. Use "fwd"/"reply" with the forwarded* fields for real quoted-block forwarding/replies.',
        },
        theme: {
          type: 'string',
          enum: ['plain', 'polished'],
          description: 'HTML visual treatment. "polished" wraps the body in a clean shell. Defaults to settings.emailTheme.',
        },
        forwardedFrom: { type: 'string', description: 'fwd/reply: original sender' },
        forwardedDate: { type: 'string', description: 'fwd/reply: original date' },
        forwardedSubject: { type: 'string', description: 'fwd/reply: original subject' },
        forwardedTo: { type: 'string', description: 'fwd/reply: original recipients' },
        forwardedBody: { type: 'string', description: 'fwd/reply: original body to quote' },
      },
      required: ['to', 'body'],
    },
  },
  handler,
};
