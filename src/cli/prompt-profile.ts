import { createInterface } from 'node:readline';
import { text, isCancel, cancel } from '@clack/prompts';
import { info, detail } from './tree.js';

/**
 * Multi-line signature capture — clack's text() is single-line, so pasting a
 * real signature (name / title / company / phone, copied from an email client)
 * submitted on the first newline and leaked the rest to the shell. This reads
 * every pasted/typed line until a blank line, so paste-from-anywhere just works
 * and multi-line signatures are entered naturally.
 */
function promptMultilineSignature(): Promise<string | undefined> {
  info('Signature appended to every draft (optional) — paste or type it, multiple lines are fine.');
  detail('Finish with a blank line (press Enter). To skip, just press Enter now.');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const lines: string[] = [];
    rl.on('line', (raw) => {
      const line = raw.replace(/\r$/, '');
      if (line.trim() === '') {
        rl.close();
        return;
      }
      lines.push(line);
    });
    rl.on('close', () => {
      // Trim leading/trailing blank lines but keep internal blank lines intact.
      resolve(lines.join('\n').replace(/^\n+|\n+$/g, '').trim() || undefined);
    });
  });
}

/** Shared by the app-password and oauth2 account-creation flows in account.ts/auth-login.ts. */
export async function promptProfileDetails(): Promise<{ displayName?: string; signature?: string }> {
  // A name is single-line — clack's text() is right here. defaultValue:'' so an
  // empty submit returns '' (not undefined, which String()-ifies to "undefined").
  const displayName = await text({
    message: '"From Name" shown to recipients (optional — e.g. "Kalpesh Gamit")',
    defaultValue: '',
  });
  if (isCancel(displayName)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const signature = await promptMultilineSignature();

  const clean = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
  return { displayName: clean(displayName), signature };
}
