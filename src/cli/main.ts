import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStatus } from './status.js';
import { runDoctor } from './doctor.js';
import { runInit, runAccountAdd } from './account.js';
import { runRotateKey } from './rotate-key.js';
import { runAuthLogin } from './auth-login.js';

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
  account: { handler: null, summary: 'list / remove / set-default (see `account add`)' },
  'account add': { handler: runAccountAdd, summary: 'Add another account' },
  'auth login': { handler: runAuthLogin, summary: 'OAuth2 consent for an account' },
  'auth rotate-key': { handler: runRotateKey, summary: 'Rotate the master encryption key' },
  contacts: { handler: null, summary: 'list / add / remove local contacts' },
  settings: { handler: null, summary: 'get / set global settings' },
  register: { handler: null, summary: 'Print the `claude mcp add` command' },
  doctor: { handler: runDoctor, summary: 'Environment pre-flight checks' },
  scheduled: { handler: null, summary: 'list pending/sent/failed scheduled sends' },
  'send-scheduled': { handler: null, summary: "Scheduler ticker's dispatch target" },
  status: { handler: runStatus, summary: 'Show configured state as a tree' },
  reset: { handler: null, summary: 'Wipe the global config directory' },
};

function getVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function printHelp(): void {
  process.stdout.write('mcp-mailman — MCP server + CLI for sending and reading Gmail\n\n');
  process.stdout.write('Usage: mcp-mailman <command> [...args]\n\n');
  process.stdout.write('Commands:\n');
  for (const [name, entry] of Object.entries(COMMANDS)) {
    const tag = entry.handler ? '' : ' (not implemented yet)';
    process.stdout.write(`  ${name.padEnd(20)} ${entry.summary}${tag}\n`);
  }
  process.stdout.write('\n  --version            Print the installed version\n');
  process.stdout.write('  --help               Print this message\n');
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
    process.stderr.write(`Unknown command: ${first}\n\nRun \`mcp-mailman --help\` for the full command list.\n`);
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
