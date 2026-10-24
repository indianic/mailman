import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { ErrorCodes } from '../errors.js';
import { listAccounts } from '../accounts.js';
import { updateSettings } from '../settings.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  defaultAccount: z.string().nullable().optional(),
  draftTtlMinutes: z.number().int().positive().optional(),
  alwaysConfirm: z.boolean().optional(),
  defaultBodyType: z.enum(['text', 'html']).optional(),
  emailTheme: z.enum(['plain', 'polished']).optional(),
  desktopNotifications: z.boolean().optional(),
  autoBccSelf: z.boolean().optional(),
  autoSend: z.boolean().optional(),
});

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const input = parsed.data;

  if (input.defaultAccount) {
    const accounts = await listAccounts();
    if (!accounts.some((a) => a.alias === input.defaultAccount)) {
      return toolError(ErrorCodes.ACCOUNT_NOT_FOUND, `No configured account with alias "${input.defaultAccount}"`);
    }
  }

  const settings = await updateSettings((current) => ({
    ...current,
    ...(input.defaultAccount !== undefined ? { defaultAccount: input.defaultAccount } : {}),
    ...(input.draftTtlMinutes !== undefined ? { draftTtlMinutes: input.draftTtlMinutes } : {}),
    ...(input.alwaysConfirm !== undefined ? { alwaysConfirm: input.alwaysConfirm } : {}),
    ...(input.defaultBodyType !== undefined ? { defaultBodyType: input.defaultBodyType } : {}),
    ...(input.emailTheme !== undefined ? { emailTheme: input.emailTheme } : {}),
    ...(input.desktopNotifications !== undefined ? { desktopNotifications: input.desktopNotifications } : {}),
    ...(input.autoBccSelf !== undefined ? { autoBccSelf: input.autoBccSelf } : {}),
    ...(input.autoSend !== undefined ? { autoSend: input.autoSend } : {}),
  }));

  return toolResponse({
    defaultAccount: settings.defaultAccount,
    draftTtlMinutes: settings.draftTtlMinutes,
    alwaysConfirm: settings.alwaysConfirm,
    defaultBodyType: settings.defaultBodyType,
    emailTheme: settings.emailTheme,
    desktopNotifications: settings.desktopNotifications,
    autoBccSelf: settings.autoBccSelf,
    autoSend: settings.autoSend,
  });
}

export const updateSettingsTool: Tool = {
  definition: {
    name: 'update_settings',
    description:
      'Update one or more global settings — default account, draft TTL, the confirm-before-send gate, default body type, HTML theme, desktop notifications, auto-send. Only the fields you pass change; returns the full updated settings.',
    inputSchema: {
      type: 'object',
      properties: {
        defaultAccount: { type: ['string', 'null'], description: 'Alias used when draft_email gets no explicit account. null clears it.' },
        draftTtlMinutes: { type: 'number', description: 'How long a draft stays confirmable before it expires' },
        alwaysConfirm: { type: 'boolean', description: "Require confirm_send's `confirm` flag on every send (default true)" },
        defaultBodyType: { type: 'string', enum: ['text', 'html'], description: "What draft_email falls back to when a call omits bodyType" },
        emailTheme: { type: 'string', enum: ['plain', 'polished'], description: 'polished = branded MailMan shell + IndiaNIC footer on HTML emails' },
        desktopNotifications: { type: 'boolean', description: 'Fire a native OS notification after each successful send (default true)' },
        autoBccSelf: { type: 'boolean', description: 'Bcc the sending account on every draft_email send so the sender keeps a copy (default false; skipped when already a recipient; never applies to campaigns)' },
        autoSend: {
          type: 'boolean',
          description:
            'Standing permission to send: draft_email sends immediately, no confirm_send step and no draft expiry (default false). Set true ONLY when the user explicitly asks to stop being asked before each send. Campaigns are never affected.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler,
};
