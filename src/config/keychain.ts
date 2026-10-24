import crypto from 'node:crypto';
import { MASTER_KEY_BYTES } from './keystore/types.js';
import { NoMasterKeyError } from './keystore/errors.js';
import { resolveForRead, resolveForCreate } from './keystore/index.js';

/**
 * The master-key surface every caller uses. Unchanged on purpose: `accounts.ts`,
 * `status.ts`, `scheduler/store.ts`, `cli/rotate-key.ts`, `cli/reset.ts` and the
 * `tools/*` error handlers all import from here and none of them had to change
 * when backends arrived underneath.
 *
 * Which backend answers is decided in `keystore/index.ts` — see
 * docs/HEADLESS-KEYSTORE.md for the resolution order and the rule that a
 * missing key is never re-created onto a different backend.
 */

// Re-exported rather than redefined: a re-export keeps class identity, so every
// `instanceof KeyringUnavailableError` already spread across tools/ and cli/
// keeps matching what the backends throw.
export { NoMasterKeyError, KeyringUnavailableError } from './keystore/errors.js';

// keytar-specific pieces still live with the backend that uses keytar; kept
// exported here because doctor.ts, reset.ts and the tests import them from this
// path.
export { getServiceName, withKeyring, type KeytarLike } from './keystore/os-keychain.js';

/**
 * Generates a random key on the first-ever call (no key stored yet) and persists
 * it through the active backend; returns the existing key otherwise. Only the
 * write path (configureAccount) should call this — read paths use
 * getMasterKeyOrThrow() so a missing key is a hard error, not a silent
 * re-generation that would orphan already-encrypted secrets.
 */
export async function getOrCreateMasterKey(): Promise<Buffer> {
  const existing = await (await resolveForRead()).read();
  if (existing) {
    return existing;
  }
  // resolveForCreate, not the read backend: the create path is the only one
  // allowed to *choose* where a key lives, and it refuses to choose at all when
  // there is existing ciphertext it might orphan.
  const prepared = await (await resolveForCreate()).prepareKey('adopt');
  await prepared.commit();
  return prepared.key;
}

/**
 * Never falls back to plaintext. If `accounts.json` was copied to a
 * machine with no matching key, this throws NoMasterKeyError — exactly the
 * "useless ciphertext with no key nearby" property the security model
 * depends on.
 */
export async function getMasterKeyOrThrow(): Promise<Buffer> {
  const existing = await (await resolveForRead()).read();
  if (!existing) {
    throw new NoMasterKeyError('No master key found for this machine — run `configure_account` again.');
  }
  return existing;
}

/**
 * Overwrites the stored key unconditionally — only `auth rotate-key` should call
 * this. Throws KeystoreNotStorableError on `passphrase`/`env`, which derive or
 * receive their key and so cannot be handed one; rotation on those goes through
 * the backend's own prepareRotation().
 */
export async function setMasterKey(key: Buffer): Promise<void> {
  await (await resolveForRead()).store(key);
}

export function generateMasterKey(): Buffer {
  return crypto.randomBytes(MASTER_KEY_BYTES);
}
