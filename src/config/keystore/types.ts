/** AES-256-GCM (config/crypto.ts) — the master key is always exactly this long. */
export const MASTER_KEY_BYTES = 32;

/**
 * `os-keychain` is deliberately not called `secret-service`: the same keytar path
 * is the macOS Keychain and the Windows Credential Manager, so a Linux-specific
 * name would be wrong on two of the three platforms it covers — and it would
 * leak into `doctor` output and into `auth migrate-keystore --to <name>`.
 */
export const BACKEND_NAMES = ['os-keychain', 'passphrase', 'env', 'file'] as const;

export type BackendName = (typeof BACKEND_NAMES)[number];

export function isBackendName(value: string): value is BackendName {
  return (BACKEND_NAMES as readonly string[]).includes(value);
}

/**
 * A rotation that has produced its next key but persisted nothing yet.
 *
 * Two-phase on purpose: `auth rotate-key` has to re-encrypt accounts.json and
 * scheduled.json under the new key *before* the new key material becomes the
 * stored one, so a crash leaves data that the still-current key can open. The
 * caller holds `key` while it rewrites those files and calls `commit()` last.
 */
export interface PreparedKey {
  key: Buffer;
  commit(): Promise<void>;
}

/**
 * `adopt` — this backend is taking over and has no material yet: the first key on
 * a fresh install, or the target of `auth migrate-keystore`. A passphrase backend
 * asks for a new passphrase twice here (a typo becomes unrecoverable ciphertext),
 * and a file backend refuses to clobber a key file that already exists.
 *
 * `rotate` — replace material this backend already owns. The passphrase backend
 * re-derives from the *existing* passphrase against a fresh salt, so the key
 * genuinely changes without the user having to memorise something new; the file
 * backend overwrites on purpose.
 */
export type KeyIntent = 'adopt' | 'rotate';

export interface KeystoreBackend {
  readonly name: BackendName;

  /**
   * True when the backend works but weakens the model relative to an OS
   * credential store. `doctor` reports these as degraded rather than healthy —
   * a working setup the user should know is a trade-off, not a green tick.
   */
  readonly degraded: boolean;

  /** One line for `doctor`/`status`: what this protects and what it costs. */
  describe(): string;

  /**
   * Can this backend be handed a key chosen elsewhere?
   *
   * False for `passphrase` (scrypt cannot be made to produce a given key) and
   * `env` (the platform owns it). It decides how migration works: a storable
   * target just receives the existing key and nothing needs re-encrypting; a
   * deriving target supplies its own key, so all ciphertext has to be rewritten
   * under it.
   */
  readonly canStore: boolean;

  /**
   * The key this backend holds, or null when it holds none yet. Null must mean
   * "nothing stored here", never "could not tell" — an unreachable store throws
   * KeyringUnavailableError, because the two are indistinguishable to the caller
   * and treating a locked keyring as empty is what silently orphans ciphertext.
   */
  read(): Promise<Buffer | null>;

  /**
   * Persist a caller-supplied key. Throws KeystoreNotStorableError when
   * `canStore` is false — see errors.ts.
   */
  store(key: Buffer): Promise<void>;

  /**
   * Produce the backend's next key, persisting nothing until `commit()`.
   *
   * Two-phase because `auth rotate-key` and `auth migrate-keystore` both have to
   * re-encrypt accounts.json and scheduled.json under the new key *before* that
   * key becomes the live one — a crash in between then leaves data the current
   * key still opens.
   */
  prepareKey(intent: KeyIntent): Promise<PreparedKey>;

  /** Remove this backend's key material. Used by `reset` and by migration. */
  remove(): Promise<void>;
}
