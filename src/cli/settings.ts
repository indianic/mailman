import { intro, outro } from '@clack/prompts';
import { getSettings, updateSettings } from '../settings.js';
import { listAccounts } from '../accounts.js';
import { section, detail, fail } from './tree.js';

// One source of truth for what each setting means and accepts — used by both
// `settings get` (to explain each row) and `settings set` (to show valid
// values on misuse). Users routinely don't know these exist or what they do,
// so every surface spells it out rather than assuming prior knowledge.
const SETTING_INFO = {
  defaultAccount: { values: '<alias> | null', desc: "account used when you don't name one" },
  draftTtlMinutes: { values: 'positive integer', desc: 'minutes an unsent draft stays valid' },
  alwaysConfirm: { values: 'true | false', desc: 'require confirmation before every send' },
  defaultBodyType: { values: 'text | html', desc: 'body format for new emails' },
  emailTheme: { values: 'plain | polished', desc: 'polished = branded shell + IndiaNIC footer (HTML)' },
  desktopNotifications: { values: 'true | false', desc: 'desktop pop-up after each send' },
} as const;

const SETTABLE_KEYS = Object.keys(SETTING_INFO) as (keyof typeof SETTING_INFO)[];

/** Indented "key   valid-values   — description" block for usage/error output. */
function keysHelp(): string {
  return SETTABLE_KEYS.map((k) => `  ${k.padEnd(21)}${SETTING_INFO[k].values.padEnd(18)} — ${SETTING_INFO[k].desc}`).join('\n');
}

/** `mailman settings get` */
export async function runSettingsGet(_args: string[]): Promise<void> {
  intro('mailman — settings');
  const settings = await getSettings();

  section('settings   (change with: mailman settings set <key> <value>)');
  const row = (k: keyof typeof SETTING_INFO, v: unknown): void =>
    detail(`${k.padEnd(21)}${String(v).padEnd(10)} — ${SETTING_INFO[k].desc}`);
  row('defaultAccount', settings.defaultAccount ?? 'none');
  row('draftTtlMinutes', settings.draftTtlMinutes);
  row('alwaysConfirm', settings.alwaysConfirm);
  row('defaultBodyType', settings.defaultBodyType);
  row('emailTheme', settings.emailTheme);
  row('desktopNotifications', settings.desktopNotifications);
  outro('settings');
}

/** `mailman settings set <key> <value>` */
export async function runSettingsSet(args: string[]): Promise<void> {
  const [key, value] = args;
  intro('mailman — settings set');
  if (!key || value === undefined) {
    fail(`Usage: mailman settings set <key> <value>\n\nKeys:\n${keysHelp()}`);
    process.exit(1);
  }
  if (!SETTABLE_KEYS.includes(key as keyof typeof SETTING_INFO)) {
    fail(`Unknown setting "${key}".\n\nKeys:\n${keysHelp()}`);
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
  } else if (key === 'desktopNotifications') {
    if (value !== 'true' && value !== 'false') {
      fail('desktopNotifications must be "true" or "false"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, desktopNotifications: value === 'true' }));
  } else if (key === 'emailTheme') {
    if (value !== 'plain' && value !== 'polished') {
      fail('emailTheme must be "plain" or "polished"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, emailTheme: value }));
  } else {
    if (value !== 'text' && value !== 'html') {
      fail('defaultBodyType must be "text" or "html"');
      process.exit(1);
    }
    await updateSettings((current) => ({ ...current, defaultBodyType: value }));
  }

  outro(`Set ${key} = ${value}`);
}
