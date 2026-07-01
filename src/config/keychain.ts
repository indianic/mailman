import crypto from 'node:crypto';

const MASTER_KEY_ACCOUNT = 'master-key';
const KEY_LENGTH_BYTES = 32; // 256-bit

export class NoMasterKeyError extends Error {}
export class KeyringUnavailableError extends Error {}

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

// keytar's CJS named exports are unreliable under a dynamic ESM import
// (static analysis misses some of its dynamically-assigned methods) — see
// src/cli/doctor.ts, which hit the same issue. Always go through .default.
async function getKeytar() {
  const mod = await import('keytar');
  return mod.default;
}

function describeKeyringFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (
    `Could not reach the OS credential store (${message}). On headless Linux this usually means no ` +
    'Secret Service daemon (gnome-keyring/kwallet) is running. mailman will not fall back to storing ' +
    'secrets in plaintext — fix the keyring and try again.'
  );
}

async function readMasterKeyRaw(): Promise<string | null> {
  const keytar = await getKeytar();
  try {
    return await keytar.getPassword(getServiceName(), MASTER_KEY_ACCOUNT);
  } catch (err) {
    throw new KeyringUnavailableError(describeKeyringFailure(err));
  }
}

/**
 * Generates a random 256-bit key on the first-ever call (no key stored
 * yet) and persists it via keytar; returns the existing key otherwise.
 * Only the write path (configureAccount) should call this — read paths
 * use getMasterKeyOrThrow() so a missing key is a hard error, not a
 * silent re-generation that would orphan already-encrypted secrets.
 */
export async function getOrCreateMasterKey(): Promise<Buffer> {
  const existing = await readMasterKeyRaw();
  if (existing) {
    return Buffer.from(existing, 'base64');
  }

  const key = crypto.randomBytes(KEY_LENGTH_BYTES);
  const keytar = await getKeytar();
  try {
    await keytar.setPassword(getServiceName(), MASTER_KEY_ACCOUNT, key.toString('base64'));
  } catch (err) {
    throw new KeyringUnavailableError(describeKeyringFailure(err));
  }
  return key;
}

/**
 * Never falls back to plaintext. If `accounts.json` was copied to a
 * machine with no matching keychain entry, this throws NoMasterKeyError —
 * exactly the "useless ciphertext with no key nearby" property the
 * security model depends on.
 */
export async function getMasterKeyOrThrow(): Promise<Buffer> {
  const existing = await readMasterKeyRaw();
  if (!existing) {
    throw new NoMasterKeyError('No master key found for this machine — run `configure_account` again.');
  }
  return Buffer.from(existing, 'base64');
}

/** Overwrites the stored key unconditionally — only `auth rotate-key` should call this. */
export async function setMasterKey(key: Buffer): Promise<void> {
  const keytar = await getKeytar();
  try {
    await keytar.setPassword(getServiceName(), MASTER_KEY_ACCOUNT, key.toString('base64'));
  } catch (err) {
    throw new KeyringUnavailableError(describeKeyringFailure(err));
  }
}

export function generateMasterKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH_BYTES);
}
