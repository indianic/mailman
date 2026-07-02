import { fail } from './tree.js';

/** True when a human can actually answer prompts — both stdin and stdout are real TTYs. */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Gate for prompt-driven commands. @clack throws a raw ERR_TTY_INIT_FAILED
 * stack trace when stdin isn't a real TTY — a real user hit exactly that by
 * running `mailman init` through an AI tool's command runner. Fail with an
 * actionable message instead, before any prompt is attempted.
 */
export function requireTty(what: string, alternative?: string): void {
  if (isInteractiveTerminal()) return;
  fail(
    `${what} is interactive — it needs a real terminal.\n` +
      `This shell isn't one (AI-tool command runners, pipes, and CI are not TTYs).\n` +
      `Open your terminal app and run it there directly.${alternative ? `\n${alternative}` : ''}`,
  );
  process.exit(1);
}
