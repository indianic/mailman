import { promises as fs } from 'node:fs';
import { getAccountsPath, getScheduledPath } from '../paths.js';
import { KeyringUnavailableError } from './errors.js';
import { BACKEND_NAMES, isBackendName, type BackendName, type KeystoreBackend } from './types.js';
import { readKeystoreRecord } from './pointer.js';
import { osKeychainBackend } from './os-keychain.js';
import { passphraseBackend } from './passphrase.js';
import { envBackend } from './env.js';
import { fileBackend } from './file.js';
import { MASTER_KEY_ENV } from './env.js';
import type { KeystoreRecord } from '../schema.js';

export const KEYSTORE_ENV = 'MAILMAN_KEYSTORE';

export function makeBackend(name: BackendName, record: KeystoreRecord | null = null): KeystoreBackend {
  switch (name) {
    case 'os-keychain':
      return osKeychainBackend();
    case 'passphrase':
      return passphraseBackend(record);
    case 'env':
      return envBackend();
    case 'file':
      return fileBackend(record);
  }
}

function requestedBackend(): BackendName | null {
  const raw = process.env[KEYSTORE_ENV]?.trim();
  if (!raw) return null;
  if (!isBackendName(raw)) {
    throw new KeyringUnavailableError(
      `${KEYSTORE_ENV}=${raw} is not a keystore mailman knows. Valid values: ${BACKEND_NAMES.join(', ')}.`,
    );
  }
  return raw;
}

/** Is there anything on disk that an existing key would be needed to read? */
async function hasEncryptedData(): Promise<boolean> {
  for (const file of [getAccountsPath(), getScheduledPath()]) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      // Cheap and deliberate: any ciphertext at all, without paying for a full
      // schema parse or caring whether the file is otherwise well-formed.
      if (raw.includes('"ciphertext"')) return true;
    } catch {
      // missing/unreadable — nothing to protect here
    }
  }
  return false;
}

/**
 * Which backend currently holds the key.
 *
 * Order, and the reason for it:
 *  1. `MAILMAN_KEYSTORE` — an explicit instruction always wins, including over a
 *     recorded pointer, so someone can override a bad record without editing it.
 *  2. `keystore.json`'s recorded backend — the deterministic answer once a key
 *     has been created through any of these backends.
 *  3. `os-keychain` — a legacy install predating keystore.json. Returned WITHOUT
 *     probing, so behaviour on macOS/Windows/desktop Linux is bit-for-bit what
 *     it was: the same keytar read, the same KeyringUnavailableError text when it
 *     fails, no extra keychain calls on the hot path.
 */
export async function resolveForRead(keychain: KeystoreBackend = osKeychainBackend()): Promise<KeystoreBackend> {
  const requested = requestedBackend();
  const record = await readKeystoreRecord();
  if (requested) return makeBackend(requested, record);
  if (record) return makeBackend(record.backend, record);
  return keychain;
}

/**
 * The one gate that enforces requirement 2. Creating a key on a backend that
 * isn't where this config dir's key was expected doesn't fail — it *succeeds*,
 * and leaves every existing credential encrypted under a key nothing will ever
 * ask for again.
 *
 * The case that makes this necessary is new: `MAILMAN_KEYSTORE=passphrase` on a
 * machine whose key is sitting in a perfectly healthy OS keychain. Resolution
 * honours the override, the passphrase backend correctly reports "no key here",
 * and the create path would happily mint a second one.
 *
 * Scoped to backend *disagreement* on purpose. A missing key on the backend that
 * legitimately owns it (someone deleted their keychain entry) is a pre-existing
 * situation with pre-existing behaviour, and not something this change reaches in
 * to alter.
 */
async function refuseIfItWouldOrphan(chosen: BackendName, record: KeystoreRecord | null, explicit: boolean): Promise<void> {
  const disagrees = record ? chosen !== record.backend : explicit && chosen !== 'os-keychain';
  if (!disagrees || !(await hasEncryptedData())) return;

  const expected = record ? `\`${record.backend}\` (recorded in keystore.json)` : '`os-keychain`';
  throw new KeyringUnavailableError(
    `Refusing to create a new master key on \`${chosen}\`: this config dir already holds encrypted ` +
      `credentials whose key belongs to ${expected}. Creating a second key would leave those credentials ` +
      'permanently unreadable.\n\n' +
      `To move the existing key deliberately: \`mailman auth migrate-keystore --to ${chosen}\`. ` +
      `To start over and lose the stored credentials: \`mailman reset --yes\`.`,
  );
}

/**
 * Which backend should hold a key that does not exist yet.
 *
 * The rule that matters is requirement 2 — never orphan existing secrets:
 *
 *  - A recorded backend is never overridden by a probe. If `keystore.json` says
 *    `passphrase`, a reachable OS keychain does not get to take over.
 *  - On a legacy install (no record) the OS keychain stays the default, and if it
 *    is unreachable while `accounts.json` already holds ciphertext, this REFUSES
 *    rather than creating a fresh key elsewhere. An unreachable Secret Service is
 *    indistinguishable from an empty one, and the difference between those two
 *    guesses is whether existing credentials survive.
 *  - Only on a genuinely empty config dir does it fall back to a headless
 *    default, because there is nothing there to orphan.
 */
export async function resolveForCreate(keychain: KeystoreBackend = osKeychainBackend()): Promise<KeystoreBackend> {
  const requested = requestedBackend();
  const record = await readKeystoreRecord();
  if (requested) {
    await refuseIfItWouldOrphan(requested, record, true);
    return makeBackend(requested, record);
  }
  if (record) return makeBackend(record.backend, record);

  try {
    await keychain.read();
    return keychain;
  } catch (err) {
    if (!(err instanceof KeyringUnavailableError)) throw err;

    if (await hasEncryptedData()) {
      throw new KeyringUnavailableError(
        `${err.message}\n\nThis config dir already holds encrypted credentials, so mailman will NOT create a ` +
          'new key on a different keystore — that would leave the existing ones permanently unreadable. Fix ' +
          'the credential store, or move the existing key deliberately with `mailman auth migrate-keystore ' +
          '--to <backend>`.',
      );
    }

    // Empty config dir on a machine with no reachable credential store: this is
    // the headless first run the whole abstraction exists for.
    if (process.env[MASTER_KEY_ENV]) return envBackend();
    return passphraseBackend(null);
  }
}

/** For `doctor`/`status`: the active backend, without touching any key material. */
export async function describeActiveBackend(): Promise<{ name: BackendName; degraded: boolean; detail: string; source: string }> {
  const requested = requestedBackend();
  const record = await readKeystoreRecord();
  const name = requested ?? record?.backend ?? 'os-keychain';
  const backend = makeBackend(name, record);
  const source = requested ? `${KEYSTORE_ENV}=${name}` : record ? 'recorded in keystore.json' : 'default (no keystore.json yet)';
  return { name, degraded: backend.degraded, detail: backend.describe(), source };
}

export { BACKEND_NAMES, isBackendName, type BackendName, type KeystoreBackend, type PreparedKey, type KeyIntent } from './types.js';
export { readKeystoreRecord, writeKeystoreRecord, clearKeystoreRecord } from './pointer.js';
export { NoMasterKeyError, KeyringUnavailableError, KeystoreNotStorableError } from './errors.js';
