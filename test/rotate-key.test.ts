import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rekeyStoredData, type RekeyOutcome } from '../src/rekey.js';
import { getAccountsPath, getScheduledPath } from '../src/config/paths.js';
import { writeJsonFile, readJsonFile } from '../src/config/store.js';
import {
  AccountsFileSchema,
  DEFAULT_ACCOUNTS_FILE,
  ScheduledFileSchema,
  DEFAULT_SCHEDULED_FILE,
} from '../src/config/schema.js';
import { encrypt, decrypt } from '../src/config/crypto.js';
import { getOrCreateMasterKey, getMasterKeyOrThrow } from '../src/config/keychain.js';
import { resolveForRead, KEYSTORE_ENV } from '../src/config/keystore/index.js';
import { KeystoreNotStorableError } from '../src/config/keystore/errors.js';
import { withIsolatedConfig as isolate } from './support/isolate.js';

const PASSPHRASE_ENV = 'MAILMAN_MASTER_PASSPHRASE';
const MASTER_KEY_ENV = 'MAILMAN_MASTER_KEY';

// Keyring-free by default (see test/support/isolate.ts): what is under test here
// is the re-encryption engine, not the credential store. The per-backend tests
// below opt into their own keystore.
const withIsolatedConfig = (fn: () => Promise<void>) =>
  isolate(() => fn(), { keystore: 'passphrase' });

/** What `auth rotate-key` does, minus the prompts. */
function rotate(overrides: Partial<Parameters<typeof rekeyStoredData>[0]> = {}): Promise<RekeyOutcome> {
  return rekeyStoredData({
    loadOldKey: getMasterKeyOrThrow,
    prepareNewKey: async () => (await resolveForRead()).prepareKey('rotate'),
    confirm: () => Promise.resolve(true),
    warn: () => {},
    ...overrides,
  });
}

/** One app-password account plus one pending scheduled send, both under `key`. */
async function seed(key: Buffer, extraEntries: { scheduledId: string; content: unknown }[] = []): Promise<void> {
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
  await writeJsonFile(getScheduledPath(), ScheduledFileSchema, {
    ...DEFAULT_SCHEDULED_FILE,
    entries: [
      {
        scheduledId: 'entry-1',
        account: 'work',
        sendAt: '2099-01-01T09:00:00.000Z',
        status: 'pending',
        attempts: 0,
        content: encrypt(
          key,
          JSON.stringify({
            to: ['someone@example.com'],
            cc: [],
            bcc: [],
            subject: 'later',
            body: 'body',
            bodyType: 'html',
            attachments: [],
          }),
        ),
      },
      ...(extraEntries as never[]),
    ],
  });
}

const readAccounts = () => readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE);
const readScheduled = () => readJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE);

// The regression this file exists for: rotation used to re-encrypt accounts.json
// only, leaving every scheduled entry readable solely under the discarded key.
// `scheduled list` broke and pending sends failed silently.
test('rotation re-encrypts scheduled sends as well as accounts', async () => {
  await withIsolatedConfig(async () => {
    const oldKey = await getOrCreateMasterKey();
    await seed(oldKey);

    const outcome = await rotate();
    assert.equal(outcome.status, 'rekeyed');
    assert.deepEqual(outcome.status === 'rekeyed' ? outcome.summary : null, {
      accountsRekeyed: 1,
      scheduledRekeyed: 1,
      scheduledSkipped: [],
      campaignsRekeyed: 0,
      campaignsSkipped: [],
    });

    const newKey = await getMasterKeyOrThrow();
    assert.notDeepEqual(newKey, oldKey, 'the stored master key must have changed');

    const scheduled = await readScheduled();
    assert.equal(JSON.parse(decrypt(newKey, scheduled.entries[0].content)).subject, 'later');
    // And the discarded key must no longer open it, or nothing was re-encrypted.
    assert.throws(() => decrypt(oldKey, scheduled.entries[0].content));

    const accounts = await readAccounts();
    assert.equal(JSON.parse(decrypt(newKey, accounts.accounts[0].credentials)).pass, 'abcd efgh ijkl mnop');
    assert.throws(() => decrypt(oldKey, accounts.accounts[0].credentials));
  });
});

test('an account that does not decrypt blocks rotation before anything is written', async () => {
  await withIsolatedConfig(async () => {
    await getOrCreateMasterKey();
    // Encrypted under a key that was never stored — the "accounts.json copied
    // from another machine" state.
    await seed(crypto.randomBytes(32));
    const before = await readScheduled();

    const outcome = await rotate();
    assert.equal(outcome.status, 'blocked');
    assert.match(outcome.status === 'blocked' ? outcome.reason : '', /do not decrypt/);
    assert.match(outcome.status === 'blocked' ? outcome.reason : '', /work/);

    // scheduled.json must be untouched: a blocked rotation writes nothing.
    assert.deepEqual(await readScheduled(), before);
  });
});

test('an undecryptable scheduled entry is warned about and left alone, not fatal', async () => {
  await withIsolatedConfig(async () => {
    const oldKey = await getOrCreateMasterKey();
    const orphan = {
      scheduledId: 'orphan-1',
      account: 'work',
      sendAt: '2099-01-01T10:00:00.000Z',
      status: 'pending' as const,
      attempts: 0,
      content: encrypt(crypto.randomBytes(32), JSON.stringify({ subject: 'unreadable' })),
    };
    await seed(oldKey, [orphan]);

    const warnings: string[] = [];
    const outcome = await rotate({ warn: (m) => warnings.push(m) });

    assert.equal(outcome.status, 'rekeyed');
    assert.deepEqual(outcome.status === 'rekeyed' ? outcome.summary.scheduledSkipped : null, ['orphan-1']);
    assert.equal(outcome.status === 'rekeyed' ? outcome.summary.scheduledRekeyed : null, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1 scheduled entry does not decrypt/);

    const stored = (await readScheduled()).entries.find((e) => e.scheduledId === 'orphan-1')!;
    assert.deepEqual(stored.content, orphan.content, 'a skipped entry must be left byte-identical');
  });
});

test('declining the confirm leaves both files and the stored key untouched', async () => {
  await withIsolatedConfig(async () => {
    const oldKey = await getOrCreateMasterKey();
    await seed(oldKey);
    const before = await Promise.all([readAccounts(), readScheduled()]);

    const outcome = await rotate({ confirm: () => Promise.resolve(false) });
    assert.equal(outcome.status, 'cancelled');

    assert.deepEqual(await Promise.all([readAccounts(), readScheduled()]), before);
    assert.deepEqual(await getMasterKeyOrThrow(), oldKey);
  });
});

test('an empty config dir reports nothing to do rather than creating a key', async () => {
  await withIsolatedConfig(async () => {
    assert.equal((await rotate()).status, 'nothing-to-do');
  });
});

// --- rotation across backends --------------------------------------------

test('rotation works on the passphrase backend by re-salting, not by storing a key', async () => {
  await withIsolatedConfig(async () => {
    process.env[KEYSTORE_ENV] = 'passphrase';
    process.env[PASSPHRASE_ENV] = 'unchanged passphrase';

    const oldKey = await getOrCreateMasterKey();
    await seed(oldKey);

    const outcome = await rotate();
    assert.equal(outcome.status, 'rekeyed');

    // Same passphrase, new salt: the key is genuinely different, and the data
    // opens under the new one.
    const newKey = await getMasterKeyOrThrow();
    assert.notDeepEqual(newKey, oldKey);
    const accounts = await readAccounts();
    assert.equal(JSON.parse(decrypt(newKey, accounts.accounts[0].credentials)).pass, 'abcd efgh ijkl mnop');
  });
});

test('rotation works on the file backend', async () => {
  await withIsolatedConfig(async () => {
    process.env[KEYSTORE_ENV] = 'file';

    const oldKey = await getOrCreateMasterKey();
    await seed(oldKey);

    assert.equal((await rotate()).status, 'rekeyed');
    const newKey = await getMasterKeyOrThrow();
    assert.notDeepEqual(newKey, oldKey);
    assert.equal(
      JSON.parse(decrypt(newKey, (await readAccounts()).accounts[0].credentials)).pass,
      'abcd efgh ijkl mnop',
    );
  });
});

test('rotation on the env backend refuses, because there is nowhere to put a new key', async () => {
  await withIsolatedConfig(async () => {
    process.env[KEYSTORE_ENV] = 'env';
    process.env[MASTER_KEY_ENV] = crypto.randomBytes(32).toString('base64');

    const key = await getOrCreateMasterKey();
    await seed(key);

    // Must fail at prepareNewKey, i.e. AFTER confirmation but BEFORE any write —
    // a half-rotation here would be unrecoverable.
    const before = await Promise.all([readAccounts(), readScheduled()]);
    await assert.rejects(() => rotate(), (err: unknown) => {
      assert.ok(err instanceof KeystoreNotStorableError);
      assert.match(err.message, /migrate-keystore/);
      return true;
    });
    assert.deepEqual(await Promise.all([readAccounts(), readScheduled()]), before);
  });
});
