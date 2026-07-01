import { dispatchDueEntries } from '../scheduler/dispatch.js';

/**
 * The scheduled-send ticker's actual dispatch target
 * (`mcp-mailman send-scheduled --due`) — invoked by the OS scheduler
 * (launchd/cron/Task Scheduler), never run manually or by an LLM. See
 * docs/CLI.md's "Deliberately not CLI commands" section for why this is
 * the one scheduling-related CLI command that exists.
 */
export async function runSendScheduled(args: string[]): Promise<void> {
  if (!args.includes('--due')) {
    process.stderr.write('Usage: mcp-mailman send-scheduled --due\n');
    process.exitCode = 1;
    return;
  }

  const summary = await dispatchDueEntries();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
