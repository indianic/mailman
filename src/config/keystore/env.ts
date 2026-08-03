import { KeyringUnavailableError, KeystoreNotStorableError } from './errors.js';
import { MASTER_KEY_BYTES, type KeystoreBackend, type PreparedKey, type KeyIntent } from './types.js';
import { writeKeystoreRecord } from './pointer.js';

export const MASTER_KEY_ENV = 'MAILMAN_MASTER_KEY';

/**
 * The master key handed straight to the process, base64, by whatever already
 * manages secrets there: a Docker/Kubernetes secret, systemd's
 * `LoadCredential=`, a CI variable.
 *
 * This is the answer for containers and CI, and the reason `file` should stay a
 * last resort. No KDF, no salt, nothing persisted by mailman at all — the
 * platform owns the secret and its rotation, which is exactly the arrangement
 * those platforms are built for.
 */
export function envBackend(): KeystoreBackend {
  const load = (): Buffer => {
    const raw = process.env[MASTER_KEY_ENV];
    if (!raw) {
      throw new KeyringUnavailableError(
        `The env keystore is selected but ${MASTER_KEY_ENV} is not set. Set it to a base64 ` +
          `${MASTER_KEY_BYTES}-byte key (generate one with: node -e "console.log(require('crypto').randomBytes(${MASTER_KEY_BYTES}).toString('base64'))").`,
      );
    }

    // Strict: Buffer.from(..., 'base64') silently ignores junk, so a truncated
    // or mistyped secret would otherwise become a *valid-looking* wrong key and
    // surface as an unexplained decrypt failure much later.
    const key = Buffer.from(raw.trim(), 'base64');
    if (key.length !== MASTER_KEY_BYTES) {
      throw new KeyringUnavailableError(
        `${MASTER_KEY_ENV} decoded to ${key.length} bytes, but the master key is ${MASTER_KEY_BYTES} bytes ` +
          '(base64 of 32 random bytes, 44 characters ending in "="). Check for a truncated or wrapped value.',
      );
    }
    return key;
  };

  const notStorable = (what: string): KeystoreNotStorableError =>
    new KeystoreNotStorableError(
      `The env keystore cannot ${what}: the key is supplied by the environment, so there is nowhere for ` +
        `mailman to put a new one. Rotate it where ${MASTER_KEY_ENV} is defined, or move to a keystore that ` +
        'owns its key (`mailman auth migrate-keystore --to os-keychain`) and rotate there.',
    );

  return {
    name: 'env',
    degraded: false,

    describe() {
      return `read from ${MASTER_KEY_ENV}: supplied by the environment, mailman persists nothing`;
    },

    // Never null: an env keystore either has its key or is misconfigured, and
    // reporting "no key yet" would send the caller down the create path and
    // orphan whatever the ciphertext was encrypted with.
    //
    // `async` rather than returning Promise.resolve(load()): the latter calls
    // load() eagerly, so a misconfigured key threw *synchronously* out of a
    // method every caller treats as returning a promise, sailing past
    // `.catch()` and `assert.rejects` alike.
    async read() {
      return load();
    },

    canStore: false,

    store(): Promise<void> {
      return Promise.reject(notStorable('store a key'));
    },

    /**
     * Adopting is fine — the key already exists, and committing only records
     * which backend is active. Rotating is not: there is nowhere for mailman to
     * put a new key, so the platform has to do it.
     */
    async prepareKey(intent: KeyIntent): Promise<PreparedKey> {
      if (intent === 'rotate') throw notStorable('rotate');
      return {
        key: load(),
        commit: () => writeKeystoreRecord({ backend: 'env', createdAt: new Date().toISOString() }),
      };
    },

    remove(): Promise<void> {
      return Promise.resolve(); // nothing was ever persisted
    },
  };
}
