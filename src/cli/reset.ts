import { promises as fs } from 'node:fs';
import { intro, outro } from '@clack/prompts';
import { fail } from './tree.js';
import { getConfigDir } from '../config/paths.js';
import { getServiceName } from '../config/keychain.js';

/**
 * `mailman reset` — wipes the entire config directory and removes the
 * keytar master-key entry, for a clean re-setup. Destructive; requires
 * explicit `--yes`, no default-confirm bypass. See docs/CLI.md.
 */
export async function runReset(args: string[]): Promise<void> {
  intro('mailman — reset');

  if (!args.includes('--yes')) {
    fail('This wipes all accounts, contacts, settings, and activity history. Re-run with --yes to confirm.');
    process.exitCode = 1;
    return;
  }

  const configDir = getConfigDir();
  await fs.rm(configDir, { recursive: true, force: true });

  try {
    const keytar = (await import('keytar')).default;
    await keytar.deletePassword(getServiceName(), 'master-key');
  } catch {
    // best-effort — a missing/unreachable keyring entry isn't a failure here
  }

  outro(`Wiped ${configDir} and removed the master key. Run \`mailman init\` to set up again.`);
}
