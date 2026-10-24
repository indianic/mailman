/**
 * Every backend throws these, and `config/keychain.ts` re-exports the first two
 * unchanged — a re-export preserves class identity, so the `instanceof` checks
 * already spread across tools/ and cli/ keep working untouched.
 *
 * They live here rather than in keychain.ts because backends need to throw them
 * and keychain.ts imports the backends; the other direction would be a cycle.
 */

export class NoMasterKeyError extends Error {}

export class KeyringUnavailableError extends Error {}

/**
 * A caller-supplied key cannot be persisted by a *deriving* backend.
 *
 * `passphrase` derives its key with scrypt and `env` is handed one by the
 * platform — neither can be made to hold an arbitrary 32 bytes, so
 * `setMasterKey(key)` is meaningless there. Rotation on those backends goes
 * through `prepareRotation()` instead, which changes the derivation input and
 * reports the key that falls out.
 */
export class KeystoreNotStorableError extends Error {}
