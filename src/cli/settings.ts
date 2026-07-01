import { log } from '@clack/prompts';
import { getSettings, updateSettings } from '../settings.js';
import { listAccounts } from '../accounts.js';

/** `mcp-mailman settings get` */
export async function runSettingsGet(_args: string[]): Promise<void> {
  const settings = await getSettings();
  process.stdout.write(
    `${JSON.stringify(
      {
        defaultAccount: settings.defaultAccount,
        draftTtlMinutes: settings.draftTtlMinutes,
        alwaysConfirm: settings.alwaysConfirm,
      },
      null,
      2,
    )}\n`,
  );
}

const SETTABLE_KEYS = ['defaultAccount', 'draftTtlMinutes', 'alwaysConfirm'] as const;

/** `mcp-mailman settings set <key> <value>` */
export async function runSettingsSet(args: string[]): Promise<void> {
  const [key, value] = args;
  if (!key || value === undefined) {
    log.error(`Usage: mcp-mailman settings set <key> <value>\nKeys: ${SETTABLE_KEYS.join(', ')}`);
    process.exit(1);
  }
  if (!SETTABLE_KEYS.includes(key as (typeof SETTABLE_KEYS)[number])) {
    log.error(`Unknown setting "${key}". Keys: ${SETTABLE_KEYS.join(', ')}`);
    process.exit(1);
  }

  if (key === 'defaultAccount') {
    if (value !== 'null') {
      const accounts = await listAccounts();
      if (!accounts.some((a) => a.alias === value)) {
        log.error(`No configured account with alias "${value}"`);
        process.exit(1);
      }
    }
    await updateSettings((current) => ({ ...current, defaultAccount: value === 'null' ? null : value }));
  } else if (key === 'draftTtlMinutes') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      log.error('draftTtlMinutes must be a positive integer');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, draftTtlMinutes: parsed }));
  } else {
    if (value !== 'true' && value !== 'false') {
      log.error('alwaysConfirm must be "true" or "false"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, alwaysConfirm: value === 'true' }));
  }

  process.stdout.write(`Set ${key} = ${value}\n`);
}
