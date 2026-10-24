import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { osKeychainBackend, credentialStoreName } from '../src/config/keystore/os-keychain.js';
import { passphraseBackend, deriveKey, SCRYPT_PARAMS } from '../src/config/keystore/passphrase.js';
import { envBackend, MASTER_KEY_ENV } from '../src/config/keystore/env.js';
import { fileBackend, defaultKeyFilePath, KEY_FILE_ENV } from '../src/config/keystore/file.js';
import { readKeystoreRecord } from '../src/config/keystore/pointer.js';
import { resolveForRead, resolveForCreate, describeActiveBackend, KEYSTORE_ENV } from '../src/config/keystore/index.js';
import type { KeystoreBackend } from '../src/config/keystore/types.js';
import { KeyringUnavailableError, KeystoreNotStorableError } from '../src/config/keystore/errors.js';
import { getAccountsPath, getConfigDir, getKeystorePath } from '../src/config/paths.js';
import { getServiceName } from '../src/config/keychain.js';

const PASSPHRASE_ENV = 'MAILMAN_MASTER_PASSPHRASE';

/** Take a backend from nothing to a live key: the first-run path. */
async function adopt(backend: KeystoreBackend): Promise<Buffer> {
  const prepared = await backend.prepareKey('adopt');
  await prepared.commit();
  return prepared.key;
}

/**
 * Every test gets a fresh config dir, which namespaces the keystore pointer, the
 * keytar service name AND (see defaultKeyFilePath) the file backend's default
 * path — requirement 4 in docs/HEADLESS-KEYSTORE.md. Env vars are saved and
 * restored so no test leaks a backend selection into the next.
 */
async function isolated(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(os.tmpdir(), `mailman-keystore-test-${crypto.randomBytes(6).toString('hex')}`);
  const saved = Object.fromEntries(
    [
      'MCP_MAILMAN_CONFIG_DIR',
      KEYSTORE_ENV,
      PASSPHRASE_ENV,
      MASTER_KEY_ENV,
      KEY_FILE_ENV,
    ].map((name) => [name, process.env[name]]),
  );
  for (const name of Object.keys(saved)) delete process.env[name];
  process.env.MCP_MAILMAN_CONFIG_DIR = dir;

  try {
    await fn(dir);
  } finally {
    const keyFile = defaultKeyFilePath();
    try {
      const keytar = (await import('keytar')).default;
      await keytar.deletePassword(getServiceName(), 'master-key');
    } catch {
      // best-effort
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(path.dirname(keyFile), { recursive: true, force: true });
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Minimum plausible ciphertext for the "would this orphan something?" guard. */
async function seedEncryptedAccount(): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(
    getAccountsPath(),
    JSON.stringify({
      schemaVersion: 1,
      accounts: [
        {
          alias: 'work',
          email: 'a@example.com',
          method: 'app-password',
          credentials: { ciphertext: 'AAAA', iv: 'BBBB', authTag: 'CCCC' },
        },
      ],
    }),
    'utf8',
  );
}

// --- passphrase -----------------------------------------------------------

test('passphrase: create then read derives the same key', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'correct horse battery staple';

    const created = await adopt(passphraseBackend(null));
    assert.equal(created.length, 32);

    // A fresh backend built from the persisted record, i.e. a new process.
    const reread = await passphraseBackend(await readKeystoreRecord()).read();
    assert.deepEqual(reread, created);
  });
});

test('passphrase: nothing is stored at rest — only a salt and a verifier', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'correct horse battery staple';
    const key = await adopt(passphraseBackend(null));

    const onDisk = await fs.readFile(getKeystorePath(), 'utf8');
    assert.doesNotMatch(onDisk, /correct horse/, 'the passphrase must never be written');
    assert.ok(!onDisk.includes(key.toString('base64')), 'the derived key must never be written');
    const record = await readKeystoreRecord();
    assert.equal(record?.backend, 'passphrase');
    assert.equal(record?.kdf?.algorithm, 'scrypt');
    assert.ok(record?.kdf?.salt);
    assert.ok(record?.kdf?.verifier);
  });
});

test('passphrase: the wrong passphrase is rejected with an explanation, not a decrypt failure', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'the right one';
    await adopt(passphraseBackend(null));
    const record = await readKeystoreRecord();

    process.env[PASSPHRASE_ENV] = 'the wrong one';
    await assert.rejects(() => passphraseBackend(record).read(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /does not match/);
      assert.match(err.message, /Nothing was changed/);
      return true;
    });
  });
});

test('passphrase: no recorded salt means no key, not an error', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'anything';
    // Null is what getMasterKeyOrThrow turns into NoMasterKeyError; a throw here
    // would instead read as "the store is broken".
    assert.equal(await passphraseBackend(null).read(), null);
  });
});

test('passphrase: a caller-supplied key cannot be stored', async () => {
  await isolated(async () => {
    await assert.rejects(() => passphraseBackend(null).store(crypto.randomBytes(32)), KeystoreNotStorableError);
  });
});

test('passphrase: rotation re-salts, so the same passphrase yields a different key', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'unchanged passphrase';
    const before = await adopt(passphraseBackend(null));
    const firstSalt = (await readKeystoreRecord())?.kdf?.salt;

    const rotation = await passphraseBackend(await readKeystoreRecord()).prepareKey('rotate');
    assert.notDeepEqual(rotation.key, before);

    // Two-phase: nothing is persisted until commit(), so a caller can re-encrypt
    // its files first and still be recoverable if it dies partway.
    assert.equal((await readKeystoreRecord())?.kdf?.salt, firstSalt);
    await rotation.commit();
    assert.notEqual((await readKeystoreRecord())?.kdf?.salt, firstSalt);

    assert.deepEqual(await passphraseBackend(await readKeystoreRecord()).read(), rotation.key);
  });
});

test('passphrase: unattended with no passphrase available fails with instructions', async () => {
  await isolated(async () => {
    // No PASSPHRASE_ENV, and nothing has registered a prompter — which is the
    // cron/CI case AND the MCP server case. Only src/cli/main.ts registers one,
    // so the config layer cannot prompt by construction rather than by checking
    // isTTY and hoping.
    await assert.rejects(() => adopt(passphraseBackend(null)), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, new RegExp(PASSPHRASE_ENV));
      assert.match(err.message, /nothing registered a prompt/);
      assert.match(err.message, /MCP server deliberately cannot prompt/);
      return true;
    });
  });
});

test('passphrase: a registered prompter is used, and only the CLI registers one', async () => {
  const { setPassphrasePrompter } = await import('../src/config/keystore/passphrase.js');
  await isolated(async () => {
    let asked = '';
    setPassphrasePrompter((message) => {
      asked = message;
      return Promise.resolve('typed at a terminal');
    });
    try {
      const key = await adopt(passphraseBackend(null));
      assert.equal(key.length, 32);
      assert.match(asked, /passphrase/i, 'the prompter must receive a human-readable message');
      // And the derived key really came from what the prompter returned.
      process.env[PASSPHRASE_ENV] = 'typed at a terminal';
      assert.deepEqual(await passphraseBackend(await readKeystoreRecord()).read(), key);
    } finally {
      setPassphrasePrompter(undefined);
    }
  });
});

test('passphrase: scrypt params are the ones Node needs an explicit maxmem for', () => {
  // N=2^15 costs exactly Node's default 32 MiB maxmem, which it rejects. If this
  // ever derives without an explicit maxmem it throws instead of being slow, so
  // assert the derivation actually runs at the shipped parameters.
  const kdf = { algorithm: 'scrypt' as const, salt: Buffer.alloc(16).toString('base64'), ...SCRYPT_PARAMS };
  assert.equal(SCRYPT_PARAMS.N, 32768);
  assert.equal(deriveKey('pw', kdf).length, 32);
  // Same inputs, same key, on any machine.
  assert.deepEqual(deriveKey('pw', kdf), deriveKey('pw', kdf));
  assert.notDeepEqual(deriveKey('pw', kdf), deriveKey('pw2', kdf));
});

// --- env ------------------------------------------------------------------

test('env: the key comes straight from the environment', async () => {
  await isolated(async () => {
    const key = crypto.randomBytes(32);
    process.env[MASTER_KEY_ENV] = key.toString('base64');

    assert.deepEqual(await envBackend().read(), key);
    assert.deepEqual(await adopt(envBackend()), key);
    // create() records the backend but persists no key material.
    assert.equal((await readKeystoreRecord())?.backend, 'env');
    assert.doesNotMatch(await fs.readFile(getKeystorePath(), 'utf8'), new RegExp(key.toString('base64').slice(0, 12)));
  });
});

test('env: a truncated or mistyped key is rejected rather than silently wrong', async () => {
  await isolated(async () => {
    // Buffer.from(..., 'base64') ignores junk and truncates happily, so without
    // an explicit length check this would become a valid-looking wrong key and
    // surface as an unexplained decrypt failure much later.
    process.env[MASTER_KEY_ENV] = crypto.randomBytes(16).toString('base64');
    await assert.rejects(() => envBackend().read(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /16 bytes/);
      assert.match(err.message, /32 bytes/);
      return true;
    });

    delete process.env[MASTER_KEY_ENV];
    await assert.rejects(() => envBackend().read(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, new RegExp(`${MASTER_KEY_ENV} is not set`));
      return true;
    });
  });
});

test('env: cannot store or rotate, and says where to rotate instead', async () => {
  await isolated(async () => {
    process.env[MASTER_KEY_ENV] = crypto.randomBytes(32).toString('base64');
    await assert.rejects(() => envBackend().store(crypto.randomBytes(32)), KeystoreNotStorableError);
    await assert.rejects(() => envBackend().prepareKey('rotate'), (err: unknown) => {
      assert.ok(err instanceof KeystoreNotStorableError);
      assert.match(err.message, /migrate-keystore/);
      return true;
    });
  });
});

// --- file -----------------------------------------------------------------

test('file: the key file lives outside the config dir', async () => {
  await isolated(async (dir) => {
    const keyFile = defaultKeyFilePath();
    assert.ok(
      !keyFile.startsWith(dir),
      `the key file must not be inside the config dir, or one copy takes both: ${keyFile}`,
    );
  });
});

test('file: create writes an owner-only key and reads it back', async () => {
  await isolated(async () => {
    const created = await adopt(fileBackend(null));
    assert.equal(created.length, 32);

    const record = await readKeystoreRecord();
    assert.equal(record?.backend, 'file');
    assert.ok(record?.keyFile);

    const { mode } = await fs.stat(record!.keyFile!);
    assert.equal(mode & 0o777, 0o600, 'the key file must not be readable by anyone else');

    assert.deepEqual(await fileBackend(record).read(), created);
  });
});

test('file: create refuses to overwrite an existing key file', async () => {
  await isolated(async () => {
    await adopt(fileBackend(null));
    // O_EXCL: a second create must not clobber a key that some config dir on this
    // machine may still be encrypted with.
    await assert.rejects(() => adopt(fileBackend(null)), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /already exists/);
      return true;
    });
  });
});

test('file: read reports no key rather than failing when the file is absent', async () => {
  await isolated(async () => {
    assert.equal(await fileBackend(null).read(), null);
  });
});

test('file: a truncated key file is an error, not a short key', async () => {
  await isolated(async () => {
    await adopt(fileBackend(null));
    const record = await readKeystoreRecord();
    await fs.writeFile(record!.keyFile!, 'dHJ1bmNhdGVk\n', 'utf8');

    await assert.rejects(() => fileBackend(record).read(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /truncated/);
      return true;
    });
  });
});

test('file: store overwrites deliberately, and remove deletes the material', async () => {
  await isolated(async () => {
    await adopt(fileBackend(null));
    const record = await readKeystoreRecord();

    const replacement = crypto.randomBytes(32);
    await fileBackend(record).store(replacement);
    assert.deepEqual(await fileBackend(record).read(), replacement);

    await fileBackend(record).remove();
    assert.equal(await fileBackend(record).read(), null);
  });
});

test('file: is reported as degraded, unlike the other backends', () => {
  assert.equal(fileBackend(null).degraded, true);
  assert.equal(envBackend().degraded, false);
  assert.equal(passphraseBackend(null).degraded, false);
  assert.equal(osKeychainBackend().degraded, false);
});

// --- resolution -----------------------------------------------------------

test('resolution: an explicit MAILMAN_KEYSTORE wins over everything', async () => {
  await isolated(async () => {
    process.env[KEYSTORE_ENV] = 'file';
    assert.equal((await resolveForRead()).name, 'file');
    assert.equal((await resolveForCreate()).name, 'file');
    assert.equal((await describeActiveBackend()).name, 'file');
    assert.match((await describeActiveBackend()).source, new RegExp(KEYSTORE_ENV));
  });
});

test('resolution: an unknown MAILMAN_KEYSTORE lists the valid values', async () => {
  await isolated(async () => {
    process.env[KEYSTORE_ENV] = 'vault';
    await assert.rejects(() => resolveForRead(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /os-keychain, passphrase, env, file/);
      return true;
    });
  });
});

test('resolution: the recorded backend beats probing, so a reachable keychain cannot take over', async () => {
  await isolated(async () => {
    process.env[PASSPHRASE_ENV] = 'recorded already';
    await adopt(passphraseBackend(null));

    // The macOS/Windows keychain is reachable in this test run; it must still
    // lose to the record, or a passphrase install would silently move.
    assert.equal((await resolveForRead()).name, 'passphrase');
    assert.equal((await resolveForCreate()).name, 'passphrase');
    assert.equal((await describeActiveBackend()).source, 'recorded in keystore.json');
  });
});

test('resolution: a legacy install with no keystore.json still resolves to os-keychain', async () => {
  await isolated(async () => {
    assert.equal((await resolveForRead()).name, 'os-keychain');
    const active = await describeActiveBackend();
    assert.equal(active.name, 'os-keychain');
    assert.match(active.source, /no keystore\.json/);
  });
});

test('resolution: an existing key is never orphaned by an explicit override', async () => {
  await isolated(async () => {
    // The dangerous new case: a healthy os-keychain install where someone sets
    // MAILMAN_KEYSTORE=passphrase. Resolution honours it, passphrase truthfully
    // reports "no key here", and the create path would mint a second key while
    // accounts.json stays encrypted under the first.
    await seedEncryptedAccount();
    process.env[KEYSTORE_ENV] = 'passphrase';
    process.env[PASSPHRASE_ENV] = 'a new passphrase';

    await assert.rejects(() => resolveForCreate(), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /Refusing to create a new master key/);
      assert.match(err.message, /migrate-keystore --to passphrase/);
      return true;
    });

    // Reads are unaffected — refusing to read would be worse than useless.
    assert.equal((await resolveForRead()).name, 'passphrase');
  });
});

test('resolution: an empty config dir with no reachable credential store picks a headless backend', async () => {
  await isolated(async () => {
    const unreachable = {
      ...osKeychainBackend(),
      read: () => Promise.reject(new KeyringUnavailableError('no Secret Service daemon')),
    };

    // Nothing to orphan, so choosing for the user is safe — this is the headless
    // first run the whole abstraction exists for.
    process.env[PASSPHRASE_ENV] = 'headless first run';
    assert.equal((await resolveForCreate(unreachable)).name, 'passphrase');

    // ...and env wins when the platform already supplies a key.
    process.env[MASTER_KEY_ENV] = crypto.randomBytes(32).toString('base64');
    assert.equal((await resolveForCreate(unreachable)).name, 'env');
  });
});

test('resolution: an unreachable credential store refuses to guess when ciphertext exists', async () => {
  await isolated(async () => {
    await seedEncryptedAccount();
    const unreachable = {
      ...osKeychainBackend(),
      read: () => Promise.reject(new KeyringUnavailableError('no Secret Service daemon')),
    };
    process.env[PASSPHRASE_ENV] = 'would orphan';

    await assert.rejects(() => resolveForCreate(unreachable), (err: unknown) => {
      assert.ok(err instanceof KeyringUnavailableError);
      assert.match(err.message, /already holds encrypted credentials/);
      assert.match(err.message, /migrate-keystore/);
      return true;
    });
  });
});

test('resolution: keystore state is isolated per config dir', async () => {
  const seen: { pointer: string; keyFile: string; service: string }[] = [];
  for (let i = 0; i < 2; i += 1) {
    await isolated(async () => {
      process.env[PASSPHRASE_ENV] = 'same passphrase in both profiles';
      await adopt(passphraseBackend(null));
      seen.push({ pointer: getKeystorePath(), keyFile: defaultKeyFilePath(), service: getServiceName() });
    });
  }
  // Requirement 4: salt, key file and keychain entry all have to be namespaced,
  // or an isolated/test profile stomps the real credentials.
  assert.notEqual(seen[0].pointer, seen[1].pointer);
  assert.notEqual(seen[0].keyFile, seen[1].keyFile);
  assert.notEqual(seen[0].service, seen[1].service);
});

// --- platform branches ------------------------------------------------------

/**
 * The `file` backend's whole purpose is that one copy of the config dir does not
 * also take the key. On Windows that hinges on picking LOCALAPPDATA over APPDATA:
 * the config dir lives under Roaming (config/paths.ts), and Windows copies a
 * roaming profile between machines by design. Getting it wrong would not raise an
 * error — it would silently undo the property.
 *
 * Asserted with an explicit platform because none of this is reachable from a Mac
 * or a Linux container, and Windows hardware is not part of the verification
 * matrix (see docs/CROSS-OS.md).
 */
test('file: the Windows key path uses LOCALAPPDATA, never the roaming profile', async () => {
  await isolated(async () => {
    const saved = { local: process.env.LOCALAPPDATA, roaming: process.env.APPDATA };
    // isolated() namespaces the default path into tmp; the platform branches only
    // apply to a real profile, so drop the override for this assertion.
    const savedConfigDir = process.env.MCP_MAILMAN_CONFIG_DIR;
    delete process.env.MCP_MAILMAN_CONFIG_DIR;
    try {
      process.env.LOCALAPPDATA = 'C:\\Users\\x\\AppData\\Local';
      process.env.APPDATA = 'C:\\Users\\x\\AppData\\Roaming';

      const win = defaultKeyFilePath('win32');
      assert.match(win, /AppData[\\/]Local/);
      assert.doesNotMatch(win, /Roaming/, 'a roaming profile is copied between machines by design');
      assert.match(win, /master\.key$/);

      // Linux/macOS: XDG state dir, and never inside the config dir.
      process.env.XDG_STATE_HOME = '/home/x/.local/state';
      const linux = defaultKeyFilePath('linux');
      assert.equal(linux, '/home/x/.local/state/mailman/master.key');
      delete process.env.XDG_STATE_HOME;
      assert.match(defaultKeyFilePath('linux'), /\.local[/\\]state[/\\]mailman[/\\]master\.key$/);
    } finally {
      if (saved.local === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = saved.local;
      if (saved.roaming === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = saved.roaming;
      delete process.env.XDG_STATE_HOME;
      if (savedConfigDir !== undefined) process.env.MCP_MAILMAN_CONFIG_DIR = savedConfigDir;
    }
  });
});

test('the credential store is named correctly on all three platforms', () => {
  // doctor prints this; naming the wrong facility is something only a user on that
  // OS would notice.
  assert.equal(credentialStoreName('darwin'), 'macOS Keychain');
  assert.equal(credentialStoreName('win32'), 'Windows Credential Manager');
  assert.equal(credentialStoreName('linux'), 'Linux Secret Service');
});
