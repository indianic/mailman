import { toolResponse } from '../response.js';
import { getSettings } from '../settings.js';
import type { Tool } from './types.js';

async function handler() {
  const settings = await getSettings();
  return toolResponse({
    defaultAccount: settings.defaultAccount,
    draftTtlMinutes: settings.draftTtlMinutes,
    alwaysConfirm: settings.alwaysConfirm,
    defaultBodyType: settings.defaultBodyType,
    desktopNotifications: settings.desktopNotifications,
    emailTheme: settings.emailTheme,
  });
}

export const getSettingsTool: Tool = {
  definition: {
    name: 'get_settings',
    description: 'Return current global settings.',
    inputSchema: { type: 'object', properties: {} },
  },
  handler,
};
