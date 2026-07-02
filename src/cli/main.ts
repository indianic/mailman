import { intro, outro } from '@clack/prompts';
import { section, detail, fail } from './tree.js';
import { getPackageVersion } from '../version.js';
import { runStatus } from './status.js';
import { runDoctor } from './doctor.js';
import { runInit, runAccountAdd, runAccountList, runAccountRemove, runAccountSetDefault, runAccountProfile } from './account.js';
import { runRotateKey } from './rotate-key.js';
import { runAuthLogin } from './auth-login.js';
import { runSettingsGet, runSettingsSet } from './settings.js';
import { runContactsList, runContactsAdd, runContactsRemove } from './contacts.js';
import { runSendScheduled } from './send-scheduled.js';
import { runScheduledList } from './scheduled.js';
import { runRegister } from './register.js';
import { runReset } from './reset.js';
import { runUpdate } from './update.js';
import { maybeNotifyUpdate, refreshUpdateCache, REFRESH_COMMAND } from './update-notifier.js';

type CommandHandler = (args: string[]) => Promise<void>;

interface CommandEntry {
  handler: CommandHandler | null; // null = planned but not implemented yet
  summary: string;
}

// Full command surface from docs/CLI.md. Most are `null` (not implemented
// yet) until their phase in docs/CHECKLIST.md lands — kept here so
// `--help` output and "unknown command" errors stay accurate as each
// phase fills one in.
const COMMANDS: Record<string, CommandEntry> = {
  init: { handler: runInit, summary: 'First-run wizard: add your first account' },
  account: { handler: null, summary: 'see `account add` / `account list` / `account profile` / `account remove` / `account set-default`' },
  'account add': { handler: runAccountAdd, summary: 'Add another account' },
  'account list': { handler: runAccountList, summary: 'Table of configured accounts' },
  'account remove': { handler: runAccountRemove, summary: 'Remove an account (--yes to skip confirm)' },
  'account set-default': { handler: runAccountSetDefault, summary: 'Set the default account' },
  'account profile': { handler: runAccountProfile, summary: 'Show or change an account\'s From Name / email signature (--name, --signature, --clear-*)' },
  'auth login': { handler: runAuthLogin, summary: 'OAuth2 consent for an account' },
  'auth rotate-key': { handler: runRotateKey, summary: 'Rotate the master encryption key' },
  contacts: { handler: null, summary: 'see `contacts list` / `contacts add` / `contacts remove`' },
  'contacts list': { handler: runContactsList, summary: 'Print the local address book' },
  'contacts add': { handler: runContactsAdd, summary: 'Add a contact manually' },
  'contacts remove': { handler: runContactsRemove, summary: 'Remove a contact' },
  settings: { handler: null, summary: 'see `settings get` / `settings set`' },
  'settings get': { handler: runSettingsGet, summary: 'Print current global settings' },
  'settings set': { handler: runSettingsSet, summary: 'Update one setting' },
  register: { handler: runRegister, summary: 'Register with AI editors (--tools <a,b|all> [--scope], -i, or bare to print the command)' },
  doctor: { handler: runDoctor, summary: 'Environment pre-flight checks' },
  scheduled: { handler: null, summary: 'see `scheduled list`' },
  'scheduled list': { handler: runScheduledList, summary: 'List pending/sent/failed scheduled sends' },
  'send-scheduled': { handler: runSendScheduled, summary: "Scheduler ticker's dispatch target (--due)" },
  status: { handler: runStatus, summary: 'Show configured state as a tree' },
  update: { handler: runUpdate, summary: 'Self-update the global install to the latest version' },
  upgrade: { handler: runUpdate, summary: 'Alias of `update`' },
  reset: { handler: runReset, summary: 'Wipe the global config directory (--yes required)' },
  // `help`/`examples` exist because people type them as subcommands (verified
  // by a real user doing exactly that) — not just as --flags.
  help: { handler: async (args) => printHelp(args[0]), summary: 'This list (or `help <command>` for one command)' },
  examples: { handler: async () => printExamples(), summary: 'Usage examples — terminal setup + what to say in your AI tool' },
};

// Tree-rendered like every other command (per the user's explicit call:
// the diamond trail applies to help/examples too, not just data commands).
// The only outputs still exempt are `--version` (bare value for scripts)
// and bare `register` (a single line whose whole purpose is pasting) —
// see docs/SKILLS.md's "Terminal output convention".
function printHelp(commandName?: string): void {
  intro('mailman — help');

  // `mailman help <command>` — just that command's line(s), matching the
  // single- or two-word form, falling back to the full list if unknown.
  if (commandName) {
    const matches = Object.entries(COMMANDS).filter(([name]) => name === commandName || name.startsWith(`${commandName} `));
    if (matches.length > 0) {
      section(commandName);
      for (const [name, entry] of matches) {
        detail(`mailman ${name.padEnd(22)} ${entry.summary}`);
      }
      outro('`mailman help` — the full list');
      return;
    }
    fail(`Unknown command: ${commandName} — showing the full list.`);
  }

  section('commands   (usage: mailman <command> [...args])');
  for (const [name, entry] of Object.entries(COMMANDS)) {
    const tag = entry.handler ? '' : ' (not implemented yet)';
    detail(`${name.padEnd(22)} ${entry.summary}${tag}`);
  }
  section('flags');
  detail('--version               Print the installed version');
  detail('--help                  This list');
  outro('New here? `mailman examples` shows setup + what to say in your AI tool.');
}

function printExamples(): void {
  intro('mailman — examples');

  section('terminal setup (once)');
  detail('mailman init                              add your first Gmail account + register your AI tools');
  detail('mailman register --tools claude,cursor    (re)write editor MCP configs without re-adding an account');
  detail("mailman status                            what's configured right now");
  detail('mailman doctor                            environment pre-flight checks');

  section('from name & email signature');
  detail('mailman account profile                                    show the current From Name + signature');
  detail('mailman account profile --name "Kalpesh Gamit"             what recipients see instead of the bare address');
  detail('mailman account profile --signature "Regards,\\nKalpesh"    appended to every draft (\\n = new line)');
  detail('mailman account profile --clear-signature                  remove it');

  section('inside your AI tool (Claude Code, Cursor, ...), in plain English');
  detail('"mailman, send those docs to kalpesh@example.com"');
  detail('"mailman, list my last 10 emails"');
  detail('"search my inbox for invoices from last month"');
  detail('"read the latest email from AWS"');
  detail('"mailman, send this tomorrow at 9am instead of now"');
  detail('"get my contacts"');

  section('safety');
  detail('Every send shows a preview first — nothing leaves the machine until you confirm.');

  outro('Full reference: `mailman help` · docs/SKILLS.md · docs/CLI.md');
}

// Plain dynamic-programming edit distance — small alphabet of ~25 command
// names, so no need for anything cleverer.
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Nearest known command within edit distance 2 (typo range — a real user
 * typed `upgarde`), or null when nothing is plausibly close. Exported for
 * unit tests.
 */
export function suggestCommand(input: string, names: string[] = Object.keys(COMMANDS)): string | null {
  let best: string | null = null;
  let bestDist = 3;
  for (const name of names) {
    const d = levenshtein(input.toLowerCase(), name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

export async function runCli(args: string[]): Promise<void> {
  const [first, second] = args;

  // Hidden subcommand the passive notifier's detached refresh re-enters
  // through — handled before everything else so it never prints a notice,
  // routes through dispatch, or appears in help.
  if (first === REFRESH_COMMAND) {
    await refreshUpdateCache();
    return;
  }

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${getPackageVersion()}\n`);
    return;
  }

  // Passive "update available" notice — cached, non-blocking, TTY-only.
  // Printed before the command's own output. Skipped for --version above
  // (scripts parse that value). Never throws.
  maybeNotifyUpdate(first ?? '');

  if (!first || first === '--help' || first === '-h') {
    printHelp();
    return;
  }

  // Two-word commands (`auth login`, `send-scheduled` variants) are looked
  // up before falling back to the single-word form.
  const twoWord = `${first} ${second}`;
  const entry = COMMANDS[twoWord] ?? COMMANDS[first];
  const rest = COMMANDS[twoWord] ? args.slice(2) : args.slice(1);

  if (!entry) {
    const hint = suggestCommand(first);
    intro('mailman');
    fail(`Unknown command: ${first}${hint ? `\nDid you mean \`mailman ${hint}\`?` : ''}`);
    outro('Run `mailman help` for the full command list.');
    process.exitCode = 1;
    return;
  }
  if (!entry.handler) {
    intro('mailman');
    fail(`\`${twoWord in COMMANDS ? twoWord : first}\` is planned but not implemented yet.`);
    outro('Run `mailman help` for the full command list.');
    process.exitCode = 1;
    return;
  }
  await entry.handler(rest);
}
