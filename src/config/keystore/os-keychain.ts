import crypto from 'node:crypto';
import { KeyringUnavailableError } from './errors.js';
import { MASTER_KEY_BYTES, type KeystoreBackend, type PreparedKey } from './types.js';
import { writeKeystoreRecord } from './pointer.js';

const MASTER_KEY_ACCOUNT = 'master-key';

/**
 * Normally a fixed service name — one machine-bound key for the real
 * config dir. When MCP_MAILMAN_CONFIG_DIR is overridden (tests, or a
 * deliberately isolated profile), the keytar service name is namespaced
 * too, so isolated runs never read/write the real default keychain entry.
 */
export function getServiceName(): string {
  const configDir = process.env.MCP_MAILMAN_CONFIG_DIR;
  if (!configDir) {
    return 'mcp-mailman';
  }
  const hash = crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 12);
  return `mcp-mailman-test-${hash}`;
}

/**
 * What the OS calls its credential store. Exported with an explicit `platform` so
 * all three names are assertable from any one machine — `doctor` prints this, and
 * naming the wrong facility is the kind of thing nobody notices until a Windows
 * user reads it.
 */
export function credentialStoreName(platform: string = process.platform): string {
  if (platform === 'darwin') return 'macOS Keychain';
  if (platform === 'win32') return 'Windows Credential Manager';
  return 'Linux Secret Service';
}

/** The slice of keytar's surface mailman uses — see withKeyring's `load` seam. */
export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

// keytar's CJS named exports are unreliable under a dynamic ESM import
// (static analysis misses some of its dynamically-assigned methods) — see
// src/cli/doctor.ts, which hit the same issue. Always go through .default.
async function getKeytar(): Promise<KeytarLike> {
  const mod = await import('keytar');
  return mod.default;
}

export function describeKeyringFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const alternatives =
    'On a headless machine, pick a keystore that needs no desktop session instead: ' +
    '`MAILMAN_KEYSTORE=passphrase` (derives the key from a passphrase, nothing at rest) or ' +
    '`MAILMAN_MASTER_KEY=<base64>` (key supplied by your orchestrator). `mailman doctor` explains both.';

  // Two failure modes that are indistinguishable from a call site and need
  // different fixes — the same distinction `mailman doctor` draws. keytar links
  // libsecret at RUNTIME, so on a headless image that never installed it the
  // native addon fails to load at all, and the user sees a linker path rather
  // than anything about keyrings.
  if (/cannot open shared object file|libsecret-1\.so/i.test(message)) {
    return (
      `keytar's native module could not be loaded: on Linux it links libsecret at runtime, and this ` +
      `machine has no libsecret (${message}). mailman will not fall back to storing secrets in ` +
      'plaintext — install it with `sudo apt install libsecret-1-0`. ' +
      alternatives
    );
  }
  return (
    `Could not reach the OS credential store (${message}). On headless Linux this usually means no ` +
    'Secret Service daemon (gnome-keyring/kwallet) is running. mailman will not fall back to storing ' +
    `secrets in plaintext. ${alternatives}`
  );
}

/**
 * Runs one keyring operation with every failure — including a failure to *load*
 * keytar at all — normalized to KeyringUnavailableError.
 *
 * The load has to be inside this try. It used to sit outside, and a missing
 * libsecret therefore escaped as a bare Error: every handler in the codebase
 * discriminates with `instanceof KeyringUnavailableError`
 * (tools/configure-account.ts, tools/confirm-send.ts, tools/mail-helpers.ts,
 * cli/account.ts, cli/rotate-key.ts), so all of them were bypassed and a
 * headless `mailman init` printed a raw linker stack trace instead of the
 * no-keyring guidance those handlers exist to give.
 *
 * `load` is a default parameter purely so tests can supply a loader that fails
 * the way a missing libsecret does — same seam style as buildLaunchdPlist's
 * `nodeBinDir` in scheduler/ticker-install.ts.
 */
export async function withKeyring<T>(
  op: (keytar: KeytarLike) => Promise<T>,
  load: () => Promise<KeytarLike> = getKeytar,
): Promise<T> {
  try {
    const keytar = await load();
    return await op(keytar);
  } catch (err) {
    throw new KeyringUnavailableError(describeKeyringFailure(err));
  }
}

/**
 * The OS credential store: macOS Keychain, Windows Credential Manager, or the
 * Linux Secret Service — all three reached through keytar. This is the original
 * and still the default behaviour wherever the store is actually reachable:
 * same service name, same account name, same storage location as before the
 * backend abstraction existed, so no existing install migrates or re-keys.
 */
export function osKeychainBackend(load?: () => Promise<KeytarLike>): KeystoreBackend {
  const run = <T>(op: (keytar: KeytarLike) => Promise<T>): Promise<T> => withKeyring(op, load);

  const persist = async (key: Buffer): Promise<void> => {
    await run((keytar) => keytar.setPassword(getServiceName(), MASTER_KEY_ACCOUNT, key.toString('base64')));
  };

  const recordSelf = (): Promise<void> =>
    writeKeystoreRecord({ backend: 'os-keychain', createdAt: new Date().toISOString() });

  return {
    name: 'os-keychain',
    degraded: false,

    describe() {
      return `via the ${credentialStoreName()}: the key is machine-bound and never touches the config dir`;
    },

    async read() {
      const stored = await run((keytar) => keytar.getPassword(getServiceName(), MASTER_KEY_ACCOUNT));
      return stored ? Buffer.from(stored, 'base64') : null;
    },

    canStore: true,

    // Records itself as active, like fileBackend's store() does. Taking the key
    // without claiming the pointer meant a *move* migration (which is exactly a
    // store() on the target) left keystore.json still naming the old backend —
    // reads kept working only because the outgoing backend happened to derive the
    // same key.
    async store(key: Buffer) {
      await persist(key);
      await recordSelf();
    },

    // Intent makes no difference here: a random key either way, and setPassword
    // overwrites whatever was there.
    prepareKey(): Promise<PreparedKey> {
      const key = crypto.randomBytes(MASTER_KEY_BYTES);
      return Promise.resolve({
        key,
        commit: async () => {
          await persist(key);
          await recordSelf();
        },
      });
    },

    async remove() {
      await run((keytar) => keytar.deletePassword(getServiceName(), MASTER_KEY_ACCOUNT));
    },
  };
}
