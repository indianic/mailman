import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { migrateKeystore } from '../src/cli/migrate-keystore.js';
import { getAccountsPath } from '../src/config/paths.js';
import { writeJsonFile, readJsonFile } from '../src/config/store.js';
import { AccountsFileSchema, DEFAULT_ACCOUNTS_FILE } from '../src/config/schema.js';
import { encrypt, decrypt } from '../src/config/crypto.js';
import { getOrCreateMasterKey, getMasterKeyOrThrow } from '../src/config/keychain.js';
import { readKeystoreRecord } from '../src/config/keystore/index.js';
import { osKeychainBackend } from '../src/config/keystore/os-keychain.js';
import { NoMasterKeyError } from '../src/config/keystore/errors.js';
import { defaultKeyFilePath } from '../src/config/keystore/file.js';
import { withIsolatedConfig as isolate, skipWithoutKeyring } from './support/isolate.js';

const PASSPHRASE_ENV = 'MAILMAN_MASTER_PASSPHRASE';
const MASTER_KEY_ENV = 'MAILMAN_MASTER_KEY';

// These start from the OS credential store deliberately — moving a key OFF it is
// the interesting case — so they are SKIPPED, not failed, where none exists.
// See test/support/isolate.ts.
const withIsolatedConfig = (fn: () => Promise<void>) =>
  isolate(() => fn(), { keystore: 'os-keychain' });

const accept = { confirm: () => Promise.resolve(true), warn: () => {} };

async function seedAccount(key: Buffer): Promise<void> {
  await writeJsonFile(getAccountsPath(), AccountsFileSchema, {
    ...DEFAULT_ACCOUNTS_FILE,
    accounts: [
      {
        alias: 'work',
        email: 'someone@example.com',
        method: 'app-password',
        credentials: encrypt(key, JSON.stringify({ user: 'someone@example.com', pass: 'abcd efgh ijkl mnop' })),
      },
    ],
  });
}

const readAccounts = () => readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE);

test('migrating to a storable backend moves the key without re-encrypting anything', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    const key = await getOrCreateMasterKey(); // os-keychain
    await seedAccount(key);
    const ciphertextBefore = (await readAccounts()).accounts[0].credentials;

    const outcome = await migrateKeystore('file', accept);
    assert.deepEqual(outcome, { status: 'moved', from: 'os-keychain', to: 'file' });

    // The same key, so not one byte of ciphertext needed rewriting — the cheap
    // and safe shape of migration.
    assert.deepEqual((await readAccounts()).accounts[0].credentials, ciphertextBefore);
    assert.deepEqual(await getMasterKeyOrThrow(), key);
    assert.equal((await readKeystoreRecord())?.backend, 'file');

    // And the source copy is gone, but only because the target was read back and
    // verified first.
    assert.equal(await osKeychainBackend().read(), null);
  });
});

test('migrating to a deriving backend re-encrypts under the key it supplies', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    const oldKey = await getOrCreateMasterKey(); // os-keychain
    await seedAccount(oldKey);
    process.env[PASSPHRASE_ENV] = 'chosen during migration';

    const outcome = await migrateKeystore('passphrase', accept);
    assert.equal(outcome.status, 'reencrypted');
    assert.equal(outcome.status === 'reencrypted' ? outcome.outcome.status : null, 'rekeyed');

    const record = await readKeystoreRecord();
    assert.equal(record?.backend, 'passphrase');
    assert.ok(record?.kdf?.salt);

    // scrypt cannot be made to produce the old key, so the data must have been
    // rewritten under the derived one.
    const newKey = await getMasterKeyOrThrow();
    assert.notDeepEqual(newKey, oldKey);
    const credentials = (await readAccounts()).accounts[0].credentials;
    assert.equal(JSON.parse(decrypt(newKey, credentials)).pass, 'abcd efgh ijkl mnop');
    assert.throws(() => decrypt(oldKey, credentials));
  });
});

test('migrating to env re-encrypts under the platform-supplied key', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    const oldKey = await getOrCreateMasterKey();
    await seedAccount(oldKey);

    const envKey = crypto.randomBytes(32);
    process.env[MASTER_KEY_ENV] = envKey.toString('base64');

    const outcome = await migrateKeystore('env', accept);
    assert.equal(outcome.status, 'reencrypted');
    assert.equal((await readKeystoreRecord())?.backend, 'env');

    // Exactly the key the environment gave, not a fresh one.
    assert.deepEqual(await getMasterKeyOrThrow(), envKey);
    assert.equal(
      JSON.parse(decrypt(envKey, (await readAccounts()).accounts[0].credentials)).pass,
      'abcd efgh ijkl mnop',
    );
  });
});

test('a round trip out to a passphrase and back leaves the credentials readable', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    const original = await getOrCreateMasterKey();
    await seedAccount(original);
    process.env[PASSPHRASE_ENV] = 'via a passphrase';

    await migrateKeystore('passphrase', accept);
    const outcome = await migrateKeystore('os-keychain', accept);

    // Coming back is a *move* (os-keychain can store), so the passphrase-derived
    // key is what ends up in the keychain — no third re-encryption.
    assert.equal(outcome.status, 'moved');
    assert.equal((await readKeystoreRecord())?.backend, 'os-keychain');

    const key = await getMasterKeyOrThrow();
    assert.notDeepEqual(key, original);
    assert.equal(
      JSON.parse(decrypt(key, (await readAccounts()).accounts[0].credentials)).pass,
      'abcd efgh ijkl mnop',
    );
  });
});

test('migrating to the already-active backend is a no-op', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    await getOrCreateMasterKey();
    assert.deepEqual(await migrateKeystore('os-keychain', accept), {
      status: 'already-active',
      backend: 'os-keychain',
    });
  });
});

test('declining the confirm moves nothing', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    const key = await getOrCreateMasterKey();
    await seedAccount(key);

    const outcome = await migrateKeystore('file', { confirm: () => Promise.resolve(false), warn: () => {} });
    assert.equal(outcome.status, 'cancelled');

    // Source untouched, the pointer still names it, nothing created at the target.
    assert.deepEqual(await osKeychainBackend().read(), key);
    assert.equal((await readKeystoreRecord())?.backend, 'os-keychain');
    await assert.rejects(() => fs.access(defaultKeyFilePath()));
  });
});

test('migrating with no key to move says so instead of creating one', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    // Nothing has ever created a key here.
    await assert.rejects(() => migrateKeystore('file', accept), (err: unknown) => {
      assert.ok(err instanceof NoMasterKeyError);
      assert.match(err.message, /nothing to migrate/);
      return true;
    });
    await assert.rejects(() => fs.access(defaultKeyFilePath()));
  });
});

// --- keyring-free coverage -------------------------------------------------

// The tests above all start from the OS credential store, so on a headless runner
// they all skip and migration would have no coverage at all. `file` is storable
// and needs no keyring, so both migration shapes stay exercised everywhere.
const withFileKeystore = (fn: () => Promise<void>) => isolate(() => fn(), { keystore: 'file' });

test('file -> passphrase re-encrypts, with no OS keyring involved', async () => {
  await withFileKeystore(async () => {
    const oldKey = await getOrCreateMasterKey();
    await seedAccount(oldKey);
    process.env[PASSPHRASE_ENV] = 'no keyring needed';
    // The target is chosen explicitly, so MAILMAN_KEYSTORE=file must not win.
    const outcome = await migrateKeystore('passphrase', accept);

    assert.equal(outcome.status, 'reencrypted');
    assert.equal((await readKeystoreRecord())?.backend, 'passphrase');
    const credentials = (await readAccounts()).accounts[0].credentials;
    assert.throws(() => decrypt(oldKey, credentials), 'the old key must no longer open it');
  });
});

test('passphrase -> file moves the derived key without re-encrypting', async () => {
  await isolate(async () => {
    const derived = await getOrCreateMasterKey(); // passphrase backend
    await seedAccount(derived);
    const before = (await readAccounts()).accounts[0].credentials;

    const warnings: string[] = [];
    const outcome = await migrateKeystore('file', { confirm: () => Promise.resolve(true), warn: (m) => warnings.push(m) });
    assert.equal(outcome.status, 'moved');
    assert.equal((await readKeystoreRecord())?.backend, 'file');
    // A storable target receives the existing key, so the ciphertext is untouched.
    assert.deepEqual((await readAccounts()).accounts[0].credentials, before);

    // MAILMAN_KEYSTORE is pinned to `passphrase` here (that is how this profile
    // selected it), and an explicit override outranks the recorded pointer on
    // every later command — so a successful migration would otherwise look like a
    // silent failure: "no master key found". Migration has to say so.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /MAILMAN_KEYSTORE is set to `passphrase`/);
    assert.match(warnings[0], /report no master key/);

    // Once the override is cleared, the moved key is exactly the derived one.
    delete process.env.MAILMAN_KEYSTORE;
    assert.deepEqual(await getMasterKeyOrThrow(), derived);
  });
});
