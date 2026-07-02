import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStatus } from './status.js';
import { runDoctor } from './doctor.js';
import { runInit, runAccountAdd, runAccountList, runAccountRemove, runAccountSetDefault } from './account.js';
import { runRotateKey } from './rotate-key.js';
import { runAuthLogin } from './auth-login.js';
import { runSettingsGet, runSettingsSet } from './settings.js';
import { runContactsList, runContactsAdd, runContactsRemove } from './contacts.js';
import { runSendScheduled } from './send-scheduled.js';
import { runScheduledList } from './scheduled.js';
import { runRegister } from './register.js';
import { runReset } from './reset.js';

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
  account: { handler: null, summary: 'see `account add` / `account list` / `account remove` / `account set-default`' },
  'account add': { handler: runAccountAdd, summary: 'Add another account' },
  'account list': { handler: runAccountList, summary: 'Table of configured accounts' },
  'account remove': { handler: runAccountRemove, summary: 'Remove an account (--yes to skip confirm)' },
  'account set-default': { handler: runAccountSetDefault, summary: 'Set the default account' },
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
  reset: { handler: runReset, summary: 'Wipe the global config directory (--yes required)' },
  // `help`/`examples` exist because people type them as subcommands (verified
  // by a real user doing exactly that) — not just as --flags.
  help: { handler: async (args) => printHelp(args[0]), summary: 'This list (or `help <command>` for one command)' },
  examples: { handler: async () => printExamples(), summary: 'Usage examples — terminal setup + what to say in your AI tool' },
};

function getVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function printHelp(commandName?: string): void {
  // `mailman help <command>` — print just that command's line (matching the
  // single- or two-word form), falling back to the full list if unknown.
  if (commandName) {
    const matches = Object.entries(COMMANDS).filter(([name]) => name === commandName || name.startsWith(`${commandName} `));
    if (matches.length > 0) {
      for (const [name, entry] of matches) {
        process.stdout.write(`  mailman ${name.padEnd(20)} ${entry.summary}\n`);
      }
      return;
    }
    process.stdout.write(`Unknown command: ${commandName} — full list:\n\n`);
  }

  process.stdout.write('mailman — MCP server + CLI for sending and reading Gmail\n\n');
  process.stdout.write('Usage: mailman <command> [...args]\n\n');
  process.stdout.write('Commands:\n');
  for (const [name, entry] of Object.entries(COMMANDS)) {
    const tag = entry.handler ? '' : ' (not implemented yet)';
    process.stdout.write(`  ${name.padEnd(20)} ${entry.summary}${tag}\n`);
  }
  process.stdout.write('\n  --version            Print the installed version\n');
  process.stdout.write('  --help               Print this message\n');
  process.stdout.write('\nNew here? `mailman examples` shows setup + what to say in your AI tool.\n');
}

// Plain text on purpose (like --help): reference material meant to be read
// and copy-pasted, not a command *result* — see docs/SKILLS.md's "Terminal
// output convention" exemptions.
function printExamples(): void {
  process.stdout.write(`mailman — examples

Terminal setup (once):

  mailman init                              add your first Gmail account + register your AI tools
  mailman register --tools claude,cursor    (re)write editor MCP configs without re-adding an account
  mailman status                            what's configured right now
  mailman doctor                            environment pre-flight checks

Everyday use happens INSIDE your AI tool (Claude Code, Cursor, ...), in plain English:

  "mailman, send those docs to kalpesh@example.com"
  "mailman, list my last 10 emails"
  "search my inbox for invoices from last month"
  "read the latest email from AWS"
  "mailman, send this tomorrow at 9am instead of now"
  "get my contacts"

Every send shows you a preview first — nothing leaves the machine until you
confirm it in the conversation. Full tool reference: docs/SKILLS.md; every
terminal command: docs/CLI.md (or \`mailman help\`).
`);
}

export async function runCli(args: string[]): Promise<void> {
  const [first, second] = args;

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }
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
    process.stderr.write(`Unknown command: ${first}\n\nRun \`mailman --help\` for the full command list.\n`);
    process.exitCode = 1;
    return;
  }
  if (!entry.handler) {
    process.stderr.write(`\`${twoWord in COMMANDS ? twoWord : first}\` is planned but not implemented yet.\n`);
    process.exitCode = 1;
    return;
  }
  await entry.handler(rest);
}
