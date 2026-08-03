import { getAccountsPath, getScheduledPath } from './config/paths.js';
import { readJsonFile, updateJsonFile } from './config/store.js';
import {
  AccountsFileSchema,
  DEFAULT_ACCOUNTS_FILE,
  ScheduledFileSchema,
  DEFAULT_SCHEDULED_FILE,
} from './config/schema.js';
import { encrypt, decrypt, type EncryptedBlob } from './config/crypto.js';
import type { PreparedKey } from './config/keystore/types.js';

/** Re-key one blob. Shared by the dry run and the real pass so they can't drift. */
function rekey(oldKey: Buffer, newKey: Buffer, blob: EncryptedBlob): EncryptedBlob {
  return encrypt(newKey, decrypt(oldKey, blob));
}

function decryptable(key: Buffer, blob: EncryptedBlob): boolean {
  try {
    decrypt(key, blob);
    return true;
  } catch {
    return false;
  }
}

export interface RekeySummary {
  accountsRekeyed: number;
  scheduledRekeyed: number;
  /** Entries that didn't decrypt under the old key, left untouched. */
  scheduledSkipped: string[];
}

export type RekeyOutcome =
  | { status: 'nothing-to-do' }
  | { status: 'cancelled' }
  | { status: 'blocked'; reason: string }
  | { status: 'rekeyed'; summary: RekeySummary };

export interface RekeyIo {
  /** The key everything is currently encrypted under. May prompt (passphrase backends). */
  loadOldKey: () => Promise<Buffer>;
  /** The key to re-encrypt under, plus how to make it live. Called only after confirmation. */
  prepareNewKey: () => Promise<PreparedKey>;
  confirm: (counts: { accounts: number; scheduled: number }) => Promise<boolean>;
  warn: (message: string) => void;
}

/**
 * Re-encrypts everything the master key covers, then makes the new key live.
 *
 * TWO files are encrypted with it, not one: `accounts.json` (credentials) and
 * `scheduled.json` (each entry's message `content`, see scheduler/store.ts).
 * `auth rotate-key` used to rewrite only the first, which left every scheduled
 * entry readable solely under the discarded key — `scheduled list` broke, and the
 * ticker hit a GCM auth-tag failure that dispatchOne swallows as retryable, so
 * pending sends died silently after MAX_ATTEMPTS.
 *
 * Shared by `auth rotate-key` and by `auth migrate-keystore` when the target
 * backend derives its own key and so cannot simply be handed the existing one.
 * No TTY or prompt of its own — everything interactive is injected, which is also
 * what makes the whole path reachable from a test.
 */
export async function rekeyStoredData(io: RekeyIo): Promise<RekeyOutcome> {
  const [accountsFile, scheduledFile] = await Promise.all([
    readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE),
    readJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE),
  ]);
  if (accountsFile.accounts.length === 0 && scheduledFile.entries.length === 0) {
    return { status: 'nothing-to-do' };
  }

  const oldKey = await io.loadOldKey();

  // Dry run before touching anything. Two files have to end up consistent with
  // one key, so discovering an undecryptable account halfway through would leave
  // scheduled.json re-encrypted under a key that never becomes live. An account
  // that won't decrypt is a hard stop; a scheduled entry that won't is
  // already-broken queue data, and refusing over it would let that damage block
  // every future rotation.
  const blockedAliases = accountsFile.accounts.filter((a) => !decryptable(oldKey, a.credentials)).map((a) => a.alias);
  if (blockedAliases.length > 0) {
    return {
      status: 'blocked',
      reason:
        `${blockedAliases.length} account(s) do not decrypt with the current master key (${blockedAliases.join(', ')}). ` +
        'accounts.json and the key are already out of sync — re-add those accounts ' +
        '(`mailman account add`) first.',
    };
  }

  const skipped = scheduledFile.entries.filter((e) => !decryptable(oldKey, e.content)).map((e) => e.scheduledId);
  if (skipped.length > 0) {
    io.warn(
      `${skipped.length} scheduled ${skipped.length === 1 ? 'entry does' : 'entries do'} not decrypt with the ` +
        'current master key and cannot be re-encrypted. They are left as they are and will keep failing to ' +
        'send — cancel them after this finishes (`mailman scheduled list`).',
    );
  }

  const rekeyable = scheduledFile.entries.length - skipped.length;
  if (!(await io.confirm({ accounts: accountsFile.accounts.length, scheduled: rekeyable }))) {
    return { status: 'cancelled' };
  }

  // After confirmation, because this is what prompts for a new passphrase.
  const prepared = await io.prepareNewKey();
  const skip = new Set(skipped);

  // Ordering, worst-case-first: scheduled.json, then accounts.json, then the new
  // key becomes live. Every write is atomic and keeps a `.bak` of the pre-write
  // content (config/store.ts), so the only lossy window is a crash after a file
  // lands but before the commit — and it costs the send queue rather than the
  // credentials. The reverse order would leave a crash with an unreadable
  // accounts.json, i.e. a mailman that cannot send at all.
  //
  // updateJsonFile rather than a plain write so re-encryption applies to the
  // freshest content on disk: the ticker is a separate process and may have
  // marked an entry `sent` since the read above.
  try {
    if (scheduledFile.entries.length > 0) {
      await updateJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE, (current) => ({
        ...current,
        entries: current.entries.map((entry) =>
          skip.has(entry.scheduledId) ? entry : { ...entry, content: rekey(oldKey, prepared.key, entry.content) },
        ),
      }));
    }

    const accounts = await updateJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE, (current) => ({
      ...current,
      accounts: current.accounts.map((account) => ({
        ...account,
        credentials: rekey(oldKey, prepared.key, account.credentials),
      })),
    }));

    await prepared.commit();

    return {
      status: 'rekeyed',
      summary: { accountsRekeyed: accounts.accounts.length, scheduledRekeyed: rekeyable, scheduledSkipped: skipped },
    };
  } catch (err) {
    // The dry run rules out the likely causes, so anything here is a
    // disk/keystore failure or a row another process wrote in between. Name the
    // files that may be mid-rotation instead of surfacing a bare stack trace.
    throw new Error(
      `Re-encryption failed partway through: ${err instanceof Error ? err.message : String(err)}\n` +
        'The new key was NOT made live, so the previous one is still the active one. If sends now fail, ' +
        `restore the pre-write copies: ${getScheduledPath()}.bak and ${getAccountsPath()}.bak`,
    );
  }
}
