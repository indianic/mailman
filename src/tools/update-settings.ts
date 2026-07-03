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
  }));

  return toolResponse({
    defaultAccount: settings.defaultAccount,
    draftTtlMinutes: settings.draftTtlMinutes,
    alwaysConfirm: settings.alwaysConfirm,
    defaultBodyType: settings.defaultBodyType,
    emailTheme: settings.emailTheme,
    desktopNotifications: settings.desktopNotifications,
  });
}

export const updateSettingsTool: Tool = {
  definition: {
    name: 'update_settings',
    description: 'Update one or more global settings.',
    inputSchema: {
      type: 'object',
      properties: {
        defaultAccount: { type: ['string', 'null'] },
        draftTtlMinutes: { type: 'number' },
        alwaysConfirm: { type: 'boolean' },
        defaultBodyType: { type: 'string', enum: ['text', 'html'] },
        emailTheme: { type: 'string', enum: ['plain', 'polished'], description: 'polished = branded MailMan shell + IndiaNIC footer on HTML emails' },
        desktopNotifications: { type: 'boolean' },
      },
    },
  },
  handler,
};
