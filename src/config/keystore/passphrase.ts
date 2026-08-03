import crypto from 'node:crypto';
import { password as passwordPrompt, isCancel } from '@clack/prompts';
import { KeyringUnavailableError, KeystoreNotStorableError } from './errors.js';
import { MASTER_KEY_BYTES, type KeystoreBackend, type PreparedKey, type KeyIntent } from './types.js';
import { writeKeystoreRecord } from './pointer.js';
import type { KeystoreKdf, KeystoreRecord } from '../schema.js';

const PASSPHRASE_ENV = 'MAILMAN_MASTER_PASSPHRASE';
const SALT_BYTES = 16;
const MIN_PASSPHRASE_LENGTH = 8;

/**
 * `N` = 2^15 is the interesting number: it costs 128·N·r = exactly 32 MiB, which
 * is Node's *default* scrypt `maxmem`, and Node rejects a request equal to the
 * limit with ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Every call therefore has to pass
 * `maxmem` explicitly — measured at ~50 ms on an M-series Mac, so budget a few
 * hundred ms on a small VPS.
 */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 } as const;

const maxmemFor = (kdf: { N: number; r: number }): number => 128 * kdf.N * kdf.r * 2;

/**
 * Derived keys, keyed by the exact KDF inputs, for the lifetime of the process.
 * scrypt is deliberately slow and a single `mailman` command can touch the key
 * several times (accounts + scheduled).
 *
 * Worth being clear about what this does NOT help: the scheduled-send ticker is
 * a fresh `npx` process on every tick, so it pays the full derivation each time.
 * That's fine at a 3-minute cadence — it just isn't something the cache fixes.
 */
const derivedKeys = new Map<string, Buffer>();

/**
 * Keyed on the passphrase as well as the salt. Keying on the salt alone is a
 * correctness bug, not just a coarse cache: within one process, `create()` would
 * populate the entry and a subsequent `read()` under a DIFFERENT passphrase would
 * hit it and be handed the right key — a wrong passphrase silently accepted.
 *
 * The passphrase is hashed rather than used directly so it isn't sitting in a
 * long-lived Map key for the life of the process.
 */
const cacheKey = (passphrase: string, kdf: KeystoreKdf): string =>
  `${kdf.algorithm}:${kdf.N}:${kdf.r}:${kdf.p}:${kdf.salt}:` +
  crypto.createHash('sha256').update(passphrase.normalize('NFKC')).digest('base64');

/** Pure and exported so the round-trip is testable without a prompt. */
export function deriveKey(passphrase: string, kdf: KeystoreKdf): Buffer {
  // NFKC so a passphrase typed with a composed vs decomposed accent (or a
  // full-width character from an IME) derives the same key on every machine.
  return crypto.scryptSync(passphrase.normalize('NFKC'), Buffer.from(kdf.salt, 'base64'), MASTER_KEY_BYTES, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: maxmemFor(kdf),
  });
}

/**
 * Lets a wrong passphrase be rejected with a sentence instead of a GCM auth-tag
 * failure from somewhere deep in a send, and lets `doctor` check the passphrase
 * before any ciphertext exists.
 *
 * This is an HMAC *of the derived key*, stored beside the ciphertext it unlocks.
 * It gives an offline attacker nothing they didn't already have: `accounts.json`
 * is itself a verifier for candidate passphrases, and either way the cost is one
 * cheap operation after the expensive scrypt that dominates a guess.
 */
export function verifierFor(key: Buffer): string {
  return crypto.createHmac('sha256', key).update('mailman-keystore-verifier-v1').digest('base64').slice(0, 22);
}

function newKdf(): KeystoreKdf {
  return { algorithm: 'scrypt', salt: crypto.randomBytes(SALT_BYTES).toString('base64'), ...SCRYPT_PARAMS };
}

function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function noPassphraseAvailable(action: string): KeyringUnavailableError {
  return new KeyringUnavailableError(
    `The passphrase keystore needs a passphrase to ${action}, and this process has no way to ask for one: ` +
      `${PASSPHRASE_ENV} is not set and stdin is not a terminal. Set ${PASSPHRASE_ENV} for unattended runs ` +
      '(cron, CI, containers), or run the command in a real terminal.',
  );
}

async function promptPassphrase(message: string): Promise<string> {
  const answer = await passwordPrompt({
    message,
    validate: (value) => (value.length < MIN_PASSPHRASE_LENGTH ? `At least ${MIN_PASSPHRASE_LENGTH} characters.` : undefined),
  });
  if (isCancel(answer)) {
    throw new KeyringUnavailableError('Cancelled — no passphrase entered, so no key could be unlocked.');
  }
  return answer;
}

/** Existing key: one prompt, then verified against the stored verifier. */
async function passphraseToUnlock(): Promise<string> {
  const fromEnv = process.env[PASSPHRASE_ENV];
  if (fromEnv) return fromEnv;
  if (!interactive()) throw noPassphraseAvailable('unlock the master key');
  return promptPassphrase('Master passphrase');
}

/**
 * New key: asked twice. A typo here is not a login failure you retry — it
 * silently becomes the passphrase, and every credential encrypted under it is
 * unrecoverable.
 */
async function passphraseToCreate(): Promise<string> {
  const fromEnv = process.env[PASSPHRASE_ENV];
  if (fromEnv) return fromEnv;
  if (!interactive()) throw noPassphraseAvailable('create a master key');

  const first = await promptPassphrase('Choose a master passphrase (nothing else can decrypt your credentials)');
  const second = await promptPassphrase('Confirm the master passphrase');
  if (first !== second) {
    throw new KeyringUnavailableError('The two passphrases did not match — nothing was created, run the command again.');
  }
  return first;
}

function unlock(passphrase: string, kdf: KeystoreKdf): Buffer {
  const slot = cacheKey(passphrase, kdf);
  const cached = derivedKeys.get(slot);
  if (cached) return cached;

  const key = deriveKey(passphrase, kdf);
  derivedKeys.set(slot, key);
  return key;
}

/**
 * Derives the master key from a passphrase — **no key material at rest**. The
 * scrypt salt lives in `keystore.json` and is not a secret.
 *
 * Be honest about what this changes: it trades machine-binding for
 * passphrase-binding. The config dir plus a known passphrase decrypts anywhere,
 * where the OS credential store would have refused. What it keeps is the
 * property the security model actually rests on — copying the config dir alone
 * yields useless ciphertext.
 */
export function passphraseBackend(record: KeystoreRecord | null): KeystoreBackend {
  const kdf = record?.backend === 'passphrase' ? record.kdf : undefined;

  const establish = async (getPassphrase: () => Promise<string>): Promise<{ key: Buffer; commit: () => Promise<void> }> => {
    const nextKdf = newKdf();
    const passphrase = await getPassphrase();
    const key = unlock(passphrase, nextKdf);
    return {
      key,
      commit: () =>
        writeKeystoreRecord({
          backend: 'passphrase',
          kdf: { ...nextKdf, verifier: verifierFor(key) },
          createdAt: new Date().toISOString(),
        }),
    };
  };

  return {
    name: 'passphrase',
    degraded: false,

    describe() {
      return (
        'derived with scrypt: no key material at rest. The config dir alone is useless without the ' +
        'passphrase, but unlike the OS credential store the key is not bound to this machine. ' +
        `${PASSPHRASE_ENV} supplies it unattended`
      );
    },

    async read() {
      // No recorded KDF means no key was ever derived here — "nothing stored",
      // which getMasterKeyOrThrow turns into NoMasterKeyError.
      if (!kdf) return null;

      const passphrase = await passphraseToUnlock();
      const key = unlock(passphrase, kdf);
      if (kdf.verifier && verifierFor(key) !== kdf.verifier) {
        // Don't leave a known-wrong derivation in the cache to be handed out on
        // the next call in this process.
        derivedKeys.delete(cacheKey(passphrase, kdf));
        throw new KeyringUnavailableError(
          'That passphrase does not match the one this config dir was encrypted with. Nothing was changed. ' +
            `If it is lost, the credentials cannot be recovered — \`mailman reset --yes\` starts over.`,
        );
      }
      return key;
    },

    canStore: false,

    store(): Promise<void> {
      return Promise.reject(
        new KeystoreNotStorableError(
          'The passphrase keystore derives its key with scrypt, so it cannot be made to hold a key chosen ' +
            'elsewhere. Use `mailman auth rotate-key` (which re-derives from a fresh salt) or ' +
            '`mailman auth migrate-keystore --to <backend>`.',
        ),
      );
    },

    /**
     * `rotate` re-derives from the *existing* passphrase against a fresh salt:
     * the key changes completely, so the rotation is real, and nobody has to
     * commit a new passphrase to memory to get it. `adopt` is a first-time
     * passphrase, so it is asked for twice.
     */
    prepareKey(intent: KeyIntent): Promise<PreparedKey> {
      return establish(intent === 'adopt' ? passphraseToCreate : passphraseToUnlock);
    },

    remove(): Promise<void> {
      // Nothing on disk to delete — the salt is inside keystore.json, and
      // whoever reassigns the pointer owns that. Deliberately does NOT clear the
      // record: during migration the pointer already names the new backend, and
      // clearing it here would erase that.
      return Promise.resolve();
    },
  };
}
