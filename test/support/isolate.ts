import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { getServiceName } from '../../src/config/keychain.js';
import { defaultKeyFilePath } from '../../src/config/keystore/file.js';

/**
 * Shared test isolation. Not a `*.test.ts` file, so `npm test`'s
 * `tsx --test test/*.test.ts` glob does not try to run it.
 *
 * Two jobs:
 *
 *  1. Point every config path, the keytar service name and the file backend's key
 *     path at throwaway locations (`MCP_MAILMAN_CONFIG_DIR` namespaces all three),
 *     so no test can read or clobber real credentials.
 *  2. Default to the **passphrase** keystore, which needs no OS keyring at all.
 *     Measured on a clean node:20-slim, `npm test` used to be 1 failure bare, 25
 *     with libsecret, 0 only with libsecret + gnome-keyring + a D-Bus session (see
 *     .gitlab-ci.yml). GitHub Actions installs only `libsecret-1-dev`, so the
 *     mirror's `npm test` was sitting in the 25-failure state. Tests that are
 *     genuinely *about* the OS credential store opt back in with
 *     `keystore: 'os-keychain'` and gate themselves on `keyringAvailable`.
 */
const MANAGED_ENV = [
  'MCP_MAILMAN_CONFIG_DIR',
  'MAILMAN_KEYSTORE',
  'MAILMAN_MASTER_PASSPHRASE',
  'MAILMAN_MASTER_KEY',
  'MAILMAN_MASTER_KEY_FILE',
] as const;

export const TEST_PASSPHRASE = 'test-suite master passphrase';

export interface IsolateOptions {
  /** Which keystore the body runs against. Defaults to the keyring-free `passphrase`. */
  keystore?: 'os-keychain' | 'passphrase' | 'env' | 'file';
  /** Extra environment for the body, cleared afterwards. */
  env?: Record<string, string>;
}

export async function withIsolatedConfig(
  fn: (dir: string) => Promise<void>,
  options: IsolateOptions = {},
): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-test-${crypto.randomBytes(6).toString('hex')}`);
  const saved = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]));
  const savedExtra = Object.fromEntries(Object.keys(options.env ?? {}).map((name) => [name, process.env[name]]));

  for (const name of MANAGED_ENV) delete process.env[name];
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;

  const keystore = options.keystore ?? 'passphrase';
  if (keystore !== 'os-keychain') process.env.MAILMAN_KEYSTORE = keystore;
  if (keystore === 'passphrase') process.env.MAILMAN_MASTER_PASSPHRASE = TEST_PASSPHRASE;
  if (keystore === 'env') process.env.MAILMAN_MASTER_KEY = crypto.randomBytes(32).toString('base64');
  Object.assign(process.env, options.env);

  try {
    await fn(dir);
  } finally {
    // Resolve the key-file path while the config dir env is still set — it is
    // namespaced off it.
    const keyFile = defaultKeyFilePath();
    try {
      const keytar = (await import('keytar')).default;
      await keytar.deletePassword(getServiceName(), 'master-key');
    } catch {
      // best-effort: on a runner with no keyring this is expected to fail
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(path.dirname(keyFile), { recursive: true, force: true });

    for (const [name, value] of Object.entries({ ...saved, ...savedExtra })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Can this machine actually use the OS credential store right now?
 *
 * Probed once, against a throwaway service name. Tests that assert
 * keychain-specific behaviour use it as a `skip` predicate so a keyring-free
 * runner reports them as skipped rather than failed — the difference between
 * "this environment cannot check that" and "that is broken".
 */
async function probeKeyring(): Promise<boolean> {
  const service = `mcp-mailman-probe-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const keytar = (await import('keytar')).default;
    await keytar.setPassword(service, 'probe', 'probe');
    const readBack = await keytar.getPassword(service, 'probe');
    await keytar.deletePassword(service, 'probe');
    return readBack === 'probe';
  } catch {
    return false;
  }
}

export const keyringAvailable = await probeKeyring();

/** `{ skip: ... }` for a test that cannot run without an OS credential store. */
export const skipWithoutKeyring = keyringAvailable
  ? undefined
  : 'no OS credential store on this machine (headless runner) — see test/support/isolate.ts';
