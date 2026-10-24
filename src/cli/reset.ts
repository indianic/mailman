import { promises as fs } from 'node:fs';
import { intro, outro } from '@clack/prompts';
import { detail, fail, section } from './tree.js';
import { getConfigDir } from '../config/paths.js';
import { resolveForRead, readKeystoreRecord } from '../config/keystore/index.js';

/**
 * `mailman reset` — wipes the entire config directory and removes the active
 * keystore's key material, for a clean re-setup. Destructive; requires
 * explicit `--yes`, no default-confirm bypass. See docs/CLI.md.
 *
 * The key material has to be removed through the backend, not by deleting a
 * keychain entry directly: the `file` backend deliberately keeps its key OUTSIDE
 * the config dir (so a copied config dir is useless), which means wiping the
 * directory alone would leave an orphaned key file behind — 32 bytes of live
 * secret sitting in `~/.local/state` that nothing will ever reference again.
 *
 * Read the record BEFORE the wipe: keystore.json is what says where the key lives
 * (and for `file`, its exact path), and it is inside the directory being deleted.
 */
export async function runReset(args: string[]): Promise<void> {
  intro('mailman — reset');

  if (!args.includes('--yes')) {
    fail('This wipes all accounts, contacts, settings, and activity history. Re-run with --yes to confirm.');
    process.exitCode = 1;
    return;
  }

  const configDir = getConfigDir();
  const record = await readKeystoreRecord();
  let backend;
  try {
    backend = await resolveForRead();
  } catch {
    // An unreadable/misconfigured keystore must not block a reset — reset is the
    // documented way out of exactly that state.
    backend = undefined;
  }

  await fs.rm(configDir, { recursive: true, force: true });

  let removed = 'no key material found';
  if (backend) {
    try {
      await backend.remove();
      removed = `removed the master key from \`${backend.name}\``;
    } catch (err) {
      // Best-effort: the config dir is already gone, so reporting is all that's
      // left to do. Naming the leftover matters most for `file`, where the key
      // is a real file the user may want to delete by hand.
      removed = `could NOT remove the key from \`${backend.name}\`${record?.keyFile ? ` (${record.keyFile})` : ''}: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  section('removed');
  detail(configDir);
  detail(removed);

  outro('Run `mailman init` to set up again.');
}
