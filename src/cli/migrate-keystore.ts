import { intro, outro, confirm, isCancel, cancel } from '@clack/prompts';
import {
  BACKEND_NAMES,
  isBackendName,
  makeBackend,
  resolveForRead,
  readKeystoreRecord,
  describeActiveBackend,
  KEYSTORE_ENV,
  type BackendName,
  type KeystoreBackend,
} from '../config/keystore/index.js';
import { NoMasterKeyError } from '../config/keystore/errors.js';
import { rekeyStoredData, describeRekeyCounts, type RekeyOutcome } from '../rekey.js';
import { isInteractiveTerminal } from './interactive.js';
import { section, detail, fail, attention } from './tree.js';

export type MigrationOutcome =
  | { status: 'already-active'; backend: BackendName }
  | { status: 'cancelled' }
  | { status: 'moved'; from: BackendName; to: BackendName }
  | { status: 'reencrypted'; from: BackendName; to: BackendName; outcome: RekeyOutcome };

/**
 * Moves the master key between backends deliberately, which is the only sanctioned
 * way to change where it lives once data exists — `resolveForCreate` refuses to
 * do it implicitly, precisely because doing it implicitly orphans ciphertext.
 *
 * Two shapes, decided by whether the target can be handed a key:
 *
 *  - **Move** (`os-keychain`, `file`): the target stores the *existing* key, so
 *    every byte of ciphertext stays valid and nothing is rewritten. The key is
 *    read back out of the target and compared before the source copy is removed —
 *    a store that silently accepted and mangled the value would otherwise be
 *    discovered on the next send, with no copy left to recover from.
 *  - **Re-encrypt** (`passphrase`, `env`): the target supplies its own key
 *    (derived, or handed over by the platform), so all ciphertext is rewritten
 *    under it via the same engine `auth rotate-key` uses.
 *
 * TTY-free and injectable for the same reason rekeyStoredData is.
 */
export async function migrateKeystore(
  target: BackendName,
  io: { confirm: (plan: { from: BackendName; to: BackendName; reencrypt: boolean }) => Promise<boolean>; warn: (message: string) => void },
): Promise<MigrationOutcome> {
  const record = await readKeystoreRecord();
  const source = await resolveForRead();
  if (source.name === target) {
    return { status: 'already-active', backend: target };
  }

  // An explicit MAILMAN_KEYSTORE outranks the recorded pointer on every future
  // command (see resolveForRead), so leaving one set that names something other
  // than the target makes a successful migration look like it silently failed:
  // the key moves, the pointer updates, and the next `mailman` still resolves to
  // the old backend and reports no master key.
  const pinned = process.env[KEYSTORE_ENV];
  if (pinned && pinned !== target) {
    io.warn(
      `${KEYSTORE_ENV} is set to \`${pinned}\` in this environment, which overrides the recorded keystore on ` +
        `every command. Unset it (or set it to \`${target}\`) once this finishes, or mailman will keep looking ` +
        `in \`${pinned}\` and report no master key.`,
    );
  }

  // Built with no record: a passphrase target needs a fresh salt, a file target
  // its default path, rather than inheriting the outgoing backend's metadata.
  const destination = makeBackend(target, null);

  if (!destination.canStore) {
    const outcome = await rekeyStoredData({
      loadOldKey: async () => {
        const key = await source.read();
        if (!key) throw noKeyToMigrate(source);
        return key;
      },
      prepareNewKey: () => destination.prepareKey('adopt'),
      confirm: () => io.confirm({ from: source.name, to: target, reencrypt: true }),
      warn: io.warn,
    });
    if (outcome.status === 'cancelled') return { status: 'cancelled' };
    // The source's own material is deliberately left in place. It no longer
    // decrypts anything (everything was rewritten under the new key), and
    // deleting a keychain entry the user may still want as a fallback is not
    // this command's call to make.
    return { status: 'reencrypted', from: source.name, to: target, outcome };
  }

  const key = await source.read();
  if (!key) throw noKeyToMigrate(source);

  if (!(await io.confirm({ from: source.name, to: target, reencrypt: false }))) {
    return { status: 'cancelled' };
  }

  await destination.store(key);

  // Read it back through a freshly-built backend, the way the next process will.
  const verification = await makeBackend(target, await readKeystoreRecord()).read();
  if (!verification || !verification.equals(key)) {
    throw new Error(
      `Migration aborted: \`${target}\` accepted the master key but did not return it unchanged. Nothing was ` +
        `removed, so \`${source.name}\` still holds the working key and your credentials are unaffected.`,
    );
  }

  // Only now is it safe: the target has been proven readable, so removing the old
  // copy cannot be the step that loses the key.
  await source.remove();
  // Reported only when there was material to delete. `passphrase` and `env`
  // remove() are no-ops — they hold nothing — and claiming a key was removed from
  // them would be a plainly false statement about the user's secrets.
  if (source.canStore && record && record.backend !== target) {
    io.warn(`Removed the master key from \`${source.name}\`.`);
  }

  return { status: 'moved', from: source.name, to: target };
}

function noKeyToMigrate(source: KeystoreBackend): NoMasterKeyError {
  return new NoMasterKeyError(
    `\`${source.name}\` holds no master key, so there is nothing to migrate. Run \`mailman init\` to set up ` +
      'an account (which creates one), or check `mailman doctor` if you expected a key to be there.',
  );
}

function usage(): void {
  section('usage');
  detail(`mailman auth migrate-keystore --to <${BACKEND_NAMES.join('|')}>`);
  detail('');
  detail('os-keychain   OS credential store (macOS Keychain, Windows Credential Manager, Secret Service)');
  detail('passphrase    scrypt from a passphrase; nothing at rest. MAILMAN_MASTER_PASSPHRASE for unattended use');
  detail('env           key supplied by the platform in MAILMAN_MASTER_KEY (containers, CI, systemd)');
  detail('file          0600 key file outside the config dir — degraded, for unattended boxes only');
}

export async function runMigrateKeystore(args: string[]): Promise<void> {
  intro('mailman — migrate keystore');

  const flagIndex = args.indexOf('--to');
  const requested = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (!requested) {
    fail('Which keystore should the master key move to? Pass `--to <backend>`.');
    usage();
    process.exitCode = 1;
    return;
  }
  if (!isBackendName(requested)) {
    fail(`\`${requested}\` is not a keystore mailman knows.`);
    usage();
    process.exitCode = 1;
    return;
  }

  const active = await describeActiveBackend();
  section('current');
  detail(`${active.name} — ${active.detail}`);
  detail(`(${active.source})`);

  // Not requireTty: migrating a headless server is a first-class use of this
  // command. It just needs the confirmation to come from somewhere, so
  // non-interactive runs have to pass --yes.
  const assumeYes = args.includes('--yes');
  if (!assumeYes && !isInteractiveTerminal()) {
    fail(
      'This rewrites where your master key lives. Re-run in a terminal, or pass `--yes` to confirm ' +
        'non-interactively (set MAILMAN_MASTER_PASSPHRASE / MAILMAN_MASTER_KEY first if the target needs it).',
    );
    process.exitCode = 1;
    return;
  }

  let outcome: MigrationOutcome;
  try {
    outcome = await migrateKeystore(requested, {
      warn: (message) => attention(message),
      confirm: async ({ from, to, reencrypt }) => {
        if (assumeYes) return true;
        const answer = await confirm({
          message: reencrypt
            ? `Move from \`${from}\` to \`${to}\`? \`${to}\` supplies its own key, so every stored credential is re-encrypted.`
            : `Move the master key from \`${from}\` to \`${to}\`? Stored credentials are not re-encrypted.`,
        });
        return !isCancel(answer) && answer;
      },
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (outcome.status === 'already-active') {
    outro(`\`${outcome.backend}\` is already the active keystore — nothing to do.`);
    return;
  }
  if (outcome.status === 'cancelled') {
    cancel('Cancelled — the master key was not moved.');
    return;
  }
  if (outcome.status === 'moved') {
    outro(`Master key moved from \`${outcome.from}\` to \`${outcome.to}\`. No credentials needed re-encrypting.`);
    return;
  }

  if (outcome.outcome.status === 'nothing-to-do') {
    outro(`Switched to \`${outcome.to}\` — there were no stored credentials to re-encrypt.`);
    return;
  }
  if (outcome.outcome.status === 'blocked') {
    fail(`Cannot migrate: ${outcome.outcome.reason}`);
    process.exit(1);
  }
  if (outcome.outcome.status === 'rekeyed') {
    const { accountsRekeyed, scheduledRekeyed, campaignsRekeyed } = outcome.outcome.summary;
    outro(
      `Migrated from \`${outcome.from}\` to \`${outcome.to}\`: re-encrypted ` +
        `${describeRekeyCounts({ accounts: accountsRekeyed, scheduled: scheduledRekeyed, campaigns: campaignsRekeyed })}.`,
    );
    return;
  }
  cancel('Cancelled — the master key was not moved.');
}
