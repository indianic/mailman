import { getKeystorePath } from '../paths.js';
import { readJsonFile, updateJsonFile } from '../store.js';
import { KeystoreFileSchema, DEFAULT_KEYSTORE_FILE, type KeystoreRecord } from '../schema.js';

/**
 * Read/write the `keystore.json` pointer. Goes through config/store.ts like
 * every other config file, so it gets the same atomic write, `.bak` copy, 0600
 * mode and per-path write queue.
 *
 * Null means "no backend recorded" — a legacy install from before this file
 * existed, whose key is in the OS credential store. It never means "no key".
 */
export async function readKeystoreRecord(): Promise<KeystoreRecord | null> {
  const file = await readJsonFile(getKeystorePath(), KeystoreFileSchema, DEFAULT_KEYSTORE_FILE);
  return file.active;
}

export async function writeKeystoreRecord(record: KeystoreRecord): Promise<void> {
  await updateJsonFile(getKeystorePath(), KeystoreFileSchema, DEFAULT_KEYSTORE_FILE, (current) => ({
    ...current,
    active: record,
  }));
}

/** Used by `reset` and by a migration that has finished moving off a backend. */
export async function clearKeystoreRecord(): Promise<void> {
  await updateJsonFile(getKeystorePath(), KeystoreFileSchema, DEFAULT_KEYSTORE_FILE, (current) => ({
    ...current,
    active: null,
  }));
}
