import { intro, outro } from '@clack/prompts';
import { getSettings, updateSettings } from '../settings.js';
import { listAccounts } from '../accounts.js';
import { section, detail, fail } from './tree.js';

/** `mailman settings get` */
export async function runSettingsGet(_args: string[]): Promise<void> {
  intro('mailman — settings');
  const settings = await getSettings();

  section('settings');
  detail(`defaultAccount    ${settings.defaultAccount ?? 'none'}`);
  detail(`draftTtlMinutes   ${settings.draftTtlMinutes}`);
  detail(`alwaysConfirm     ${settings.alwaysConfirm}`);
  detail(`defaultBodyType   ${settings.defaultBodyType}`);
  outro('settings');
}

const SETTABLE_KEYS = ['defaultAccount', 'draftTtlMinutes', 'alwaysConfirm', 'defaultBodyType'] as const;

/** `mailman settings set <key> <value>` */
export async function runSettingsSet(args: string[]): Promise<void> {
  const [key, value] = args;
  intro('mailman — settings set');
  if (!key || value === undefined) {
    fail(`Usage: mailman settings set <key> <value>\nKeys: ${SETTABLE_KEYS.join(', ')}`);
    process.exit(1);
  }
  if (!SETTABLE_KEYS.includes(key as (typeof SETTABLE_KEYS)[number])) {
    fail(`Unknown setting "${key}". Keys: ${SETTABLE_KEYS.join(', ')}`);
    process.exit(1);
  }

  if (key === 'defaultAccount') {
    if (value !== 'null') {
      const accounts = await listAccounts();
      if (!accounts.some((a) => a.alias === value)) {
        fail(`No configured account with alias "${value}"`);
        process.exit(1);
      }
    }
    await updateSettings((current) => ({ ...current, defaultAccount: value === 'null' ? null : value }));
  } else if (key === 'draftTtlMinutes') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      fail('draftTtlMinutes must be a positive integer');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, draftTtlMinutes: parsed }));
  } else if (key === 'alwaysConfirm') {
    if (value !== 'true' && value !== 'false') {
      fail('alwaysConfirm must be "true" or "false"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, alwaysConfirm: value === 'true' }));
  } else {
    if (value !== 'text' && value !== 'html') {
      fail('defaultBodyType must be "text" or "html"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, defaultBodyType: value }));
  }

  outro(`Set ${key} = ${value}`);
}
