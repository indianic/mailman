import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrCreateMasterKey,
  getMasterKeyOrThrow,
  setMasterKey,
  generateMasterKey,
  getServiceName,
  withKeyring,
  NoMasterKeyError,
  KeyringUnavailableError,
  type KeytarLike,
} from '../src/config/keychain.js';
import { osKeychainBackend } from '../src/config/keystore/os-keychain.js';
import { withIsolatedConfig, skipWithoutKeyring } from './support/isolate.js';

// These exercise the OS credential store specifically — that is the point of the
// file — so they run on `os-keychain` and are SKIPPED (not failed) where no
// credential store exists. See test/support/isolate.ts.
const withIsolatedKeychain = (fn: () => Promise<void>) =>
  withIsolatedConfig(() => fn(), { keystore: 'os-keychain' });

test('getMasterKeyOrThrow throws NoMasterKeyError when no key has ever been created', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedKeychain(async () => {
    await assert.rejects(() => getMasterKeyOrThrow(), NoMasterKeyError);
  });
});

test('getOrCreateMasterKey generates a 256-bit key and reuses it on later calls', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedKeychain(async () => {
    const first = await getOrCreateMasterKey();
    assert.equal(first.length, 32);
    const second = await getOrCreateMasterKey();
    assert.deepEqual(first, second);
  });
});

test('getMasterKeyOrThrow returns the key created by getOrCreateMasterKey', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedKeychain(async () => {
    const created = await getOrCreateMasterKey();
    const read = await getMasterKeyOrThrow();
    assert.deepEqual(created, read);
  });
});

test('setMasterKey overwrites the stored key unconditionally', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedKeychain(async () => {
    await getOrCreateMasterKey();
    const newKey = generateMasterKey();
    await setMasterKey(newKey);
    const read = await getMasterKeyOrThrow();
    assert.deepEqual(read, newKey);
  });
});

// The exact error a headless Linux box produces: keytar links libsecret at
// runtime, so with no libsecret the native addon fails to LOAD — the failure
// happens in the import, not in the keyring call.
const LIBSECRET_LOAD_ERROR =
  '/usr/lib/node_modules/@integratex/mailman/node_modules/keytar/build/Release/keytar.node: ' +
  'libsecret-1.so.0: cannot open shared object file: No such file or directory';

const failingLoader = (): Promise<KeytarLike> => Promise.reject(new Error(LIBSECRET_LOAD_ERROR));

// Regression: the keytar import used to sit OUTSIDE the try/catch, so this
// escaped as a bare Error and slipped past every `instanceof
// KeyringUnavailableError` handler in the codebase — a headless `mailman init`
// printed a raw linker stack trace instead of the no-keyring guidance.
//
// Asserted against the backend rather than keychain.ts's exports because that is
// where the load lives; keychain.ts's public functions take no loader argument,
// which is what keeps their signatures stable for every existing caller.
for (const [name, call] of [
  ['read', () => osKeychainBackend(failingLoader).read()],
  ['prepareKey', () => osKeychainBackend(failingLoader).prepareKey('adopt').then((p) => p.commit())],
  ['store', () => osKeychainBackend(failingLoader).store(generateMasterKey())],
  ['remove', () => osKeychainBackend(failingLoader).remove()],
] as const) {
  test(`os-keychain ${name}() reports an unloadable keytar as KeyringUnavailableError`, async () => {
    await assert.rejects(call, (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError, `expected KeyringUnavailableError, got ${(err as Error)?.constructor?.name}`);
      // The user's actual fix has to be in the message — a linker path alone
      // tells them nothing about what to install.
      assert.match(err.message, /libsecret/);
      assert.match(err.message, /apt install libsecret-1-0/);
      return true;
    });
  });
}

test('withKeyring distinguishes an unreachable Secret Service from a missing library', async () => {
  const noDaemon: KeytarLike = {
    getPassword: () => Promise.reject(new Error('The name org.freedesktop.secrets was not provided by any .service files')),
    setPassword: () => Promise.reject(new Error('unused')),
    deletePassword: () => Promise.reject(new Error('unused')),
  };
  await assert.rejects(
    () => withKeyring((keytar) => keytar.getPassword('svc', 'acct'), () => Promise.resolve(noDaemon)),
    (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /no Secret Service daemon/);
      // Must NOT send someone to install a library they already have.
      assert.doesNotMatch(err.message, /apt install/);
      return true;
    },
  );
});

test('withKeyring returns the operation result when the keyring works', async () => {
  const fake: KeytarLike = {
    getPassword: () => Promise.resolve('stored-value'),
    setPassword: () => Promise.resolve(),
    deletePassword: () => Promise.resolve(true),
  };
  const value = await withKeyring((keytar) => keytar.getPassword('svc', 'acct'), () => Promise.resolve(fake));
  assert.equal(value, 'stored-value');
});

test('different MCP_MAILMAN_CONFIG_DIR overrides get isolated, non-colliding service names', () => {
  const priorEnv = process.env.MCP_MAILMAN_CONFIG_DIR;
  process.env.MCP_MAILMAN_CONFIG_DIR = '/tmp/profile-a';
  const serviceA = getServiceName();
  process.env.MCP_MAILMAN_CONFIG_DIR = '/tmp/profile-b';
  const serviceB = getServiceName();
  if (priorEnv === undefined) {
    delete process.env.MCP_MAILMAN_CONFIG_DIR;
  } else {
    process.env.MCP_MAILMAN_CONFIG_DIR = priorEnv;
  }
  assert.notEqual(serviceA, serviceB);
});
