import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { getSettings } from '../settings.js';
import { createDraft, type DraftAttachment } from '../drafts.js';
import { resolveAttachments } from './resolve-attachments.js';
import { formatFromAddress, appendSignature, resolveSignatureType, wrapPolished } from '../mail/compose.js';
import { normalizeRecipientFields } from '../mail/recipients.js';
import { getTemplate, applySubjectPrefix, buildForwardedBody } from '../mail/templates.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  // Shape only — the addresses themselves are validated by
  // normalizeRecipientFields, which also accepts the separated-string and
  // "Name <addr>" forms that a bare z.string().email() rejects outright.
  to: z.union([z.string(), z.array(z.string()).min(1)]),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
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
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
});

function defaultSubject(attachments: DraftAttachment[]): string {
  return attachments.length > 0 ? `Files attached: ${attachments.map((a) => a.name).join(', ')}` : 'Files attached';
}

/**
 * The preview must show what will actually be delivered, but a big HTML body
 * echoed back in full on every draft is pure token overhead — cap it well above
 * any realistic signature + theme shell and say so when it is cut.
 */
const FINAL_BODY_PREVIEW_LIMIT = 6000;

/**
 * Composition mistakes that were previously invisible until a recipient saw
 * them. Every real incident here reads back to one of two mismatches: markup
 * in a text send, or text conventions in an html send.
 */
export function composeWarnings(
  body: string,
  bodyType: 'text' | 'html',
  signature: string | undefined,
  signatureType?: 'text' | 'html',
): string[] {
  const warnings: string[] = [];
  const hasTags = /<[a-z][a-z0-9]*(\s[^>]*)?>/i.test(body);

  if (signature && bodyType === 'text' && resolveSignatureType(signature, signatureType) === 'html') {
    warnings.push(
      'The account signature is HTML but this email is plain text — it was converted to a text-only fallback. Send with bodyType "html" to deliver the signature as designed.',
    );
  }
  if (bodyType === 'text' && hasTags) {
    warnings.push('The body contains HTML tags but bodyType is "text" — recipients will see the raw markup, not rendered formatting.');
  }
  if (bodyType === 'html' && !hasTags && body.includes('\n')) {
    warnings.push(
      'The body has line breaks but no HTML markup, and bodyType is "html" — newlines collapse when rendered, so it will arrive as one run-on paragraph. Use <br>/<p>/<ul> markup, or send with bodyType "text".',
    );
  }
  if (bodyType === 'html' && /(^|\n)\s*(?:[-*] |#{1,3} )|\*\*[^*\n]+\*\*/.test(body)) {
    warnings.push('The body looks like Markdown, which email clients do not render — convert bullets/headings/bold to HTML tags.');
  }
  return warnings;
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

  const recipients = normalizeRecipientFields({ to: input.to, cc: input.cc, bcc: input.bcc });
  if (!recipients.ok) {
    return toolError('INVALID_INPUT', recipients.message);
  }

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

  let body = appendSignature(composed, account.signature, bodyType, account.signatureType);
  const signatureAppended = Boolean(account.signature) && body !== composed;

  // Polished theme — opt-in, HTML only. Wraps the whole body in a clean shell.
  const theme = input.theme ?? settings.emailTheme;
  const polished = bodyType === 'html' && theme === 'polished';
  if (polished) body = wrapPolished(body);

  const warnings = composeWarnings(composed, bodyType, account.signature, account.signatureType);

  // settings.autoBccSelf: the sender keeps a copy of everything they send.
  // Skipped when their address is already a recipient anywhere — a second copy
  // of the same message is noise, not a record.
  const bcc = [...recipients.bcc];
  const self = account.email.toLowerCase();
  const alreadyRecipient = [...recipients.to, ...recipients.cc, ...recipients.bcc].some(
    (addr) => addr.toLowerCase() === self,
  );
  const autoBccSelf = settings.autoBccSelf && !alreadyRecipient;
  if (autoBccSelf) bcc.push(account.email);

  const draft = createDraft({
    account: account.alias,
    to: recipients.to,
    cc: recipients.cc,
    bcc,
    subject,
    body,
    bodyType,
    attachments: resolved.files,
    rawAttachments: input.attachments,
    recursive: input.recursive,
    inReplyTo: input.inReplyTo,
    // A reply to a root message has References = [that message]. Defaulted so a
    // caller only has to pass the one id it got from read_email; pass the array
    // explicitly to preserve a longer chain.
    references: input.references ?? (input.inReplyTo ? [input.inReplyTo] : undefined),
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
      // The caller's own body, truncated — quick orientation only.
      bodyPreview: input.body.length > 280 ? `${input.body.slice(0, 280)}…` : input.body,
      // What will ACTUALLY be dispatched: body + signature + theme shell. A
      // `signatureAppended: true` flag alone proved useless — it was accurate
      // while the composed output was visibly broken. Capped generously so a
      // huge body can't flood the response; the cap is flagged when hit.
      finalBody:
        draft.body.length > FINAL_BODY_PREVIEW_LIMIT
          ? `${draft.body.slice(0, FINAL_BODY_PREVIEW_LIMIT)}…`
          : draft.body,
      ...(draft.body.length > FINAL_BODY_PREVIEW_LIMIT ? { finalBodyTruncated: true } : {}),
      ...(signatureAppended ? { signatureAppended: true } : {}),
      ...(autoBccSelf ? { autoBccSelf: true } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(template ? { template: template.key } : {}),
      ...(polished ? { theme: 'polished' } : {}),
      attachments: draft.attachments.map((a) => ({ name: a.name, sizeBytes: a.sizeBytes, mimeType: a.mimeType })),
    },
    next_steps: [
      warnings.length > 0
        ? 'This draft has warnings — surface them to the user along with the preview before calling confirm_send.'
        : 'Show this preview to the user and get explicit confirmation before calling confirm_send.',
    ],
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
        to: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Recipients. An array is clearest for several: ["alice@example.com","bob@example.com"]. One comma- or semicolon-separated string works too, as does "Name <alice@example.com>". Every address given lands in To — never move an extra recipient to cc to work around a rejection.',
        },
        cc: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Same accepted forms as `to`.',
        },
        bcc: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Same accepted forms as `to`.',
        },
        subject: { type: 'string', description: 'Optional — a minimal default is filled in if omitted' },
        body: { type: 'string', description: 'The message body you compose. Plain text unless bodyType is "html".' },
        bodyType: { type: 'string', enum: ['text', 'html'], description: 'Defaults to settings.defaultBodyType when omitted' },
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
        inReplyTo: {
          type: 'string',
          description:
            "The original's Message-ID, from read_email's messageId (e.g. \"<abc@mail.gmail.com>\"). Set this on a reply or the message arrives as a new thread rather than under the one it answers. Not the read_email `id`, which is a provider-local handle.",
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: "Full Message-ID chain for a deep thread. Omit and it defaults to [inReplyTo], which is correct for replying to a root message.",
        },
      },
      required: ['to', 'body'],
      additionalProperties: false,
    },
  },
  handler,
};
