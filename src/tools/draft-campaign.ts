import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { resolveAccount, AccountResolutionError } from '../accounts.js';
import { getSettings } from '../settings.js';
import { listContacts } from '../contacts.js';
import { resolveAttachments } from './resolve-attachments.js';
import { formatFromAddress, appendSignature, wrapPolished } from '../mail/compose.js';
import { parseRecipientEntries, parseRecipientList } from '../mail/recipients.js';
import { getTemplate, applySubjectPrefix } from '../mail/templates.js';
import { createCampaign } from '../campaigns/store.js';
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_THROTTLE_PER_MINUTE } from '../campaigns/dispatch.js';
import {
  deriveVars,
  estimateDuration,
  renderTemplate,
  selectSamples,
  type RecipientPlan,
} from '../campaigns/render.js';
import type { Tool } from './types.js';

const RecipientObjectSchema = z.object({
  email: z.string(),
  vars: z.record(z.string()).optional(),
});

const InputSchema = z.object({
  recipients: z.union([
    z.string(),
    z.array(z.string()).min(1),
    z.array(RecipientObjectSchema).min(1),
  ]),
  subject: z.string().optional(),
  body: z.string(),
  bodyType: z.enum(['text', 'html']).optional(),
  theme: z.enum(['plain', 'polished']).optional(),
  account: z.string().optional(),
  template: z.string().optional(),
  attachments: z.array(z.string()).optional(),
  recursive: z.boolean().optional(),
  ccFirstOnly: z.union([z.string(), z.array(z.string())]).optional(),
  throttlePerMinute: z.number().int().positive().max(600).optional(),
});

/** Phrases that mean the sender is talking to a room, not to one person. */
const GROUP_LANGUAGE = /\b(hi|hello|hey|dear)\s+(team|everyone|all|folks|guys)\b|\ball of you\b/i;

interface ResolvedRecipient {
  email: string;
  vars: Record<string, string>;
}

function normalizeRecipients(
  input: z.infer<typeof InputSchema>['recipients'],
  contactNames: Map<string, string>,
): { ok: true; recipients: ResolvedRecipient[] } | { ok: false; message: string } {
  // Bare strings: "a@x.com", ["a@x.com","Yash S <b@x.com>"], "a@x.com, b@x.com".
  if (typeof input === 'string' || typeof input[0] === 'string') {
    const { entries, invalid } = parseRecipientEntries(input as string | string[]);
    if (invalid.length > 0) {
      return { ok: false, message: `Not a usable email address: ${invalid.map((e) => `"${e}"`).join(', ')}` };
    }
    return {
      ok: true,
      recipients: entries.map((e) => ({
        email: e.address,
        // An inline "Name <addr>" beats the address book: the caller typed it
        // for this campaign, and it is the fresher of the two.
        vars: deriveVars(e.address, e.name ?? contactNames.get(e.address.toLowerCase())),
      })),
    };
  }

  const objects = input as Array<z.infer<typeof RecipientObjectSchema>>;
  const recipients: ResolvedRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of objects) {
    const parsed = parseRecipientEntries(item.email);
    if (parsed.invalid.length > 0 || parsed.entries.length !== 1) {
      invalid.push(item.email);
      continue;
    }
    const { address, name } = parsed.entries[0];
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      email: address,
      vars: deriveVars(address, name ?? contactNames.get(key), item.vars),
    });
  }

  if (invalid.length > 0) {
    return {
      ok: false,
      message: `Not a usable email address: ${invalid.map((e) => `"${e}"`).join(', ')}. Each recipient object needs exactly one address in "email".`,
    };
  }
  return { ok: true, recipients };
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

  const template = input.template ? getTemplate(input.template) : undefined;
  if (input.template && !template) {
    return toolError('INVALID_INPUT', `Unknown template "${input.template}". Call list_templates to see available keys.`);
  }

  // Validated now so a bad path fails at draft time rather than at recipient 1
  // of 39. The paths themselves are stored raw and re-resolved at send time.
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

  const ccParsed = parseRecipientList(input.ccFirstOnly ?? []);
  if (ccParsed.invalid.length > 0) {
    return toolError('INVALID_INPUT', `ccFirstOnly: not a usable email address — ${ccParsed.invalid.join(', ')}`);
  }

  const contacts = await listContacts();
  const contactNames = new Map<string, string>();
  for (const c of contacts) {
    if (c.name?.trim()) contactNames.set(c.email.toLowerCase(), c.name.trim());
  }

  const normalized = normalizeRecipients(input.recipients, contactNames);
  if (!normalized.ok) {
    return toolError('INVALID_INPUT', normalized.message);
  }
  if (normalized.recipients.length === 0) {
    return toolError('INVALID_INPUT', 'At least one recipient is required.');
  }

  const settings = await getSettings();
  const bodyType = input.bodyType ?? settings.defaultBodyType;
  const theme = input.theme ?? settings.emailTheme;
  const polished = bodyType === 'html' && theme === 'polished';

  const subjectTemplate = template
    ? applySubjectPrefix(template.subjectPrefix, input.subject ?? '')
    : (input.subject ?? '').trim();
  if (!subjectTemplate) {
    return toolError('INVALID_INPUT', 'A campaign needs a subject — 39 individually addressed messages with no subject line read as spam.');
  }

  // Compose exactly as draft_email would, then freeze it. Rendering happens
  // per recipient at send time against this composed string, so what the
  // reviewer approves and what leaves the machine are the same object.
  const signed = appendSignature(input.body, account.signature, bodyType);
  const bodyTemplate = polished ? wrapPolished(signed) : signed;

  // Plan every recipient before persisting anything, so an unresolvable token
  // means no campaign exists at all rather than a broken one sitting on disk.
  const plans: RecipientPlan[] = normalized.recipients.map((r, seq) => {
    const subject = renderTemplate(subjectTemplate, r.vars, 'text');
    const wire = renderTemplate(bodyTemplate, r.vars, bodyType);
    const preview = renderTemplate(input.body, r.vars, bodyType);
    return {
      seq,
      email: r.email,
      vars: r.vars,
      subject: subject.text,
      bodyPreview: preview.text.length > 240 ? `${preview.text.slice(0, 240)}…` : preview.text,
      unresolved: [...new Set([...subject.unresolved, ...wire.unresolved])],
      fallbacks: [...new Set([...subject.fallbacks, ...wire.fallbacks])],
    };
  });

  // Refuse to draft (docs/CAMPAIGNS.md §4.2, option 1). "Hi ," is worse than
  // any group greeting, and this is the last moment it can be stopped for
  // free — after confirm_campaign it is in someone's inbox.
  const unresolved = plans.filter((p) => p.unresolved.length > 0);
  if (unresolved.length > 0) {
    const shown = unresolved.slice(0, 10).map((p) => `${p.email} (${p.unresolved.map((t) => `{{${t}}}`).join(', ')})`);
    const more = unresolved.length > shown.length ? ` …and ${unresolved.length - shown.length} more` : '';
    return toolError(
      ErrorCodes.CAMPAIGN_UNRESOLVED,
      `Nothing was drafted: ${unresolved.length} of ${plans.length} recipient(s) have a placeholder with no value — ` +
        `${shown.join('; ')}${more}. ` +
        'Fix it one of three ways: add the missing names (add_contact), pass them inline as ' +
        '{"email":"…","vars":{"name":"…"}}, or give the token a fallback — {{first_name|there}} renders "Hi there,".',
    );
  }

  const campaign = await createCampaign({
    account: account.alias,
    throttlePerMinute: input.throttlePerMinute ?? DEFAULT_THROTTLE_PER_MINUTE,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    content: {
      subjectTemplate,
      bodyTemplate,
      bodyType,
      attachments: input.attachments ?? [],
      recursive: input.recursive,
      ccFirstOnly: ccParsed.addresses,
      recipients: normalized.recipients,
    },
  });

  const warnings: string[] = [];

  const fallbackPlans = plans.filter((p) => p.fallbacks.length > 0);
  if (fallbackPlans.length > 0) {
    const names = fallbackPlans.slice(0, 8).map((p) => p.email).join(', ');
    const more = fallbackPlans.length > 8 ? `, …and ${fallbackPlans.length - 8} more` : '';
    warnings.push(
      `${fallbackPlans.length} recipient(s) have no name on file and will get the fallback greeting: ${names}${more}`,
    );
  }

  if (plans.every((p) => p.subject === plans[0].subject && p.bodyPreview === plans[0].bodyPreview)) {
    warnings.push(
      'No placeholders resolved differently — every recipient gets identical text. That is still a valid merge ' +
        '(each person sees only their own address), but if a shared reply thread is wanted, draft_email with the ' +
        'list in to/cc is the honest shape.',
    );
  }

  if (GROUP_LANGUAGE.test(input.body)) {
    warnings.push(
      'The body addresses a group ("Hi team" / "everyone"). Personalising a message that is plainly collective ' +
        'reads as fake intimacy — consider draft_email broadcast instead.',
    );
  }

  const recipientSet = new Set(normalized.recipients.map((r) => r.email.toLowerCase()));
  const ccAlsoRecipient = ccParsed.addresses.filter((a) => recipientSet.has(a.toLowerCase()));
  if (ccAlsoRecipient.length > 0) {
    warnings.push(
      `${ccAlsoRecipient.join(', ')} appear(s) in both ccFirstOnly and the recipient list, and will get two emails.`,
    );
  }

  return toolResponse({
    campaignId: campaign.campaignId,
    total: plans.length,
    throttlePerMinute: campaign.throttlePerMinute,
    estimatedDuration: estimateDuration(plans.length, campaign.throttlePerMinute),
    from: formatFromAddress(account.email, account.displayName),
    ccFirstOnly: ccParsed.addresses,
    ...(polished ? { theme: 'polished' } : {}),
    ...(template ? { template: template.key } : {}),
    attachments: resolved.files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes, mimeType: f.mimeType })),
    samples: selectSamples(plans).map((p) => ({
      to: p.email,
      subject: p.subject,
      bodyPreview: p.bodyPreview,
      ...(p.fallbacks.length > 0 ? { usedFallbackFor: p.fallbacks } : {}),
    })),
    unresolved: [],
    warnings,
    next_steps: [
      `Show these samples and every warning to the user verbatim. One confirm_campaign call sends all ${plans.length} messages, so this preview is the only review that happens.`,
      'On approval, call confirm_campaign with confirm:true.',
    ],
  });
}

export const draftCampaignTool: Tool = {
  definition: {
    name: 'draft_campaign',
    description:
      'Prepare a personalised merge — N separate messages, one per recipient, each with only that recipient in To. Renders {{name}}/{{first_name}}/{{email}} per person and returns a preview WITHOUT sending. Use this when each recipient should be addressed individually and must not see the others; use draft_email when the message is genuinely collective and a shared reply thread is wanted. Refuses to draft if any placeholder has no value for some recipient.',
    inputSchema: {
      type: 'object',
      properties: {
        recipients: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  vars: { type: 'object', additionalProperties: { type: 'string' } },
                },
                required: ['email'],
                additionalProperties: false,
              },
            },
          ],
          description:
            'Bare addresses (array or one comma-separated string), "Name <addr>" to supply the name inline, or objects {"email":"…","vars":{"name":"…","company":"…"}} for per-recipient values. Names not given here are looked up in contacts.',
        },
        subject: { type: 'string', description: 'May contain placeholders. Required — a subjectless merge reads as spam.' },
        body: {
          type: 'string',
          description:
            'The message, with {{name}}, {{first_name}}, {{email}}, or any custom token you passed in vars. Give a token a fallback with {{first_name|there}} — otherwise a recipient with no name on file makes the whole draft fail.',
        },
        bodyType: { type: 'string', enum: ['text', 'html'], description: 'Defaults to settings.defaultBodyType' },
        theme: { type: 'string', enum: ['plain', 'polished'], description: 'HTML visual treatment. Defaults to settings.emailTheme.' },
        account: { type: 'string', description: 'Account alias; omit to use the only/default configured account' },
        template: { type: 'string', description: 'Optional message template key (see list_templates)' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Paths/globs/dirs — the same files go to every recipient' },
        recursive: { type: 'boolean', description: 'Expand directory attachments recursively' },
        ccFirstOnly: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Cc attached to the FIRST message only, then dropped — how leadership sees the campaign went out without receiving N copies. Never use plain cc semantics here.',
        },
        throttlePerMinute: {
          type: 'number',
          description: 'Send pace, default 20. Gmail app-password accounts have burst limits, and tripping one fails the rest of the run.',
        },
      },
      required: ['recipients', 'body'],
      additionalProperties: false,
    },
  },
  handler,
};
