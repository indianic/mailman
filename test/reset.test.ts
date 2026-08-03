import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { runReset } from '../src/cli/reset.js';
import { getConfigDir } from '../src/config/paths.js';
import { getOrCreateMasterKey } from '../src/config/keychain.js';
import { KEYSTORE_ENV } from '../src/config/keystore/index.js';
import { osKeychainBackend } from '../src/config/keystore/os-keychain.js';
import { defaultKeyFilePath } from '../src/config/keystore/file.js';
import { withIsolatedConfig as isolate, skipWithoutKeyring } from './support/isolate.js';

// These start from the OS credential store deliberately — moving a key OFF it is
// the interesting case — so they are SKIPPED, not failed, where none exists.
// See test/support/isolate.ts.
const withIsolatedConfig = (fn: () => Promise<void>) =>
  isolate(() => fn(), { keystore: 'os-keychain' });

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false);

test('reset without --yes destroys nothing', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    await getOrCreateMasterKey();
    const priorExitCode = process.exitCode;

    await runReset([]);

    assert.equal(await exists(getConfigDir()), true);
    assert.notEqual(await osKeychainBackend().read(), null);
    process.exitCode = priorExitCode;
  });
});

test('reset removes the config dir and the key from the OS credential store', { skip: skipWithoutKeyring }, async () => {
  await withIsolatedConfig(async () => {
    await getOrCreateMasterKey();
    assert.notEqual(await osKeychainBackend().read(), null);

    await runReset(['--yes']);

    assert.equal(await exists(getConfigDir()), false);
    assert.equal(await osKeychainBackend().read(), null);
  });
});

// The reason reset had to change at all: the file backend keeps its key OUTSIDE
// the config dir on purpose, so wiping the directory left 32 bytes of live secret
// behind that nothing would ever reference again.
test('reset deletes a file-backend key that lives outside the config dir', async () => {
  await withIsolatedConfig(async () => {
    process.env[KEYSTORE_ENV] = 'file';
    await getOrCreateMasterKey();

    const keyFile = defaultKeyFilePath();
    assert.equal(await exists(keyFile), true);
    assert.ok(!keyFile.startsWith(getConfigDir()), 'precondition: the key file is outside the config dir');

    await runReset(['--yes']);

    assert.equal(await exists(getConfigDir()), false);
    assert.equal(await exists(keyFile), false, 'the orphaned key file must not survive a reset');
  });
});

test('reset still wipes the config dir when the keystore cannot be read', async () => {
  // `isolate` directly, on the keyring-free passphrase keystore: this test is
  // about surviving a broken *selection*, so needing a working credential store
  // just to reach the interesting line would be backwards.
  await isolate(async () => {
    await getOrCreateMasterKey();
    // Reset is the documented way out of a broken keystore, so a bad selection
    // must not be what stops it.
    process.env[KEYSTORE_ENV] = 'not-a-backend';

    await runReset(['--yes']);
    assert.equal(await exists(getConfigDir()), false);
  });
});
