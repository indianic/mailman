import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureAccount,
  resolveAccount,
  removeAccount,
  updateAccountProfile,
  AccountResolutionError,
  AccountRemovalConfirmationError,
} from '../src/accounts.js';
import { getSettings, updateSettings } from '../src/settings.js';
import { withIsolatedConfig } from './support/isolate.js';

// Isolated per test, and on the keyring-free `passphrase` keystore by default
// (see test/support/isolate.ts): a fresh MCP_MAILMAN_CONFIG_DIR namespaces the
// config files, the keytar service name and the file-backend key path, so these
// never touch real config or the real machine-wide keychain entry — and they run
// on a CI runner with no OS credential store at all.
const withIsolatedEnv = (fn: () => Promise<void>) => withIsolatedConfig(() => fn());

function appPasswordInput(alias: string, setDefault?: boolean) {
  return {
    alias,
    email: `${alias}@example.com`,
    method: 'app-password' as const,
    credentials: { user: `${alias}@example.com`, pass: 'sixteencharpass1' },
    setDefault,
  };
}

test('resolveAccount: explicit alias resolves to that account', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    const account = await resolveAccount('a');
    assert.equal(account.alias, 'a');
  });
});

test('resolveAccount: explicit alias that does not exist throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => resolveAccount('nope'), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});

test('resolveAccount: no accounts configured throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await assert.rejects(() => resolveAccount(), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});

test('resolveAccount: single account with no alias resolves automatically', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('only'));
    const account = await resolveAccount();
    assert.equal(account.alias, 'only');
  });
});

test('resolveAccount: multiple accounts, no default set, no alias -> AMBIGUOUS_ACCOUNT', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await configureAccount(appPasswordInput('b'));
    // configureAccount auto-defaults the first account ever added — clear
    // it explicitly to reach the genuinely-no-default state.
    await updateSettings((current) => ({ ...current, defaultAccount: null }));
    await assert.rejects(() => resolveAccount(), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'AMBIGUOUS_ACCOUNT');
      return true;
    });
  });
});

test('resolveAccount: multiple accounts, settings-driven default, no alias -> resolves to the default', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // becomes default (first account)
    await configureAccount(appPasswordInput('b'));
    const account = await resolveAccount();
    assert.equal(account.alias, 'a');
  });
});

test('configureAccount: first account auto-defaults; second does not displace it without setDefault', async () => {
  await withIsolatedEnv(async () => {
    const first = await configureAccount(appPasswordInput('a'));
    assert.equal(first.isDefault, true);

    const second = await configureAccount(appPasswordInput('b'));
    assert.equal(second.isDefault, false);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'a');
  });
});

test('configureAccount: setDefault: true moves the default to the new account', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    const second = await configureAccount(appPasswordInput('b', true));
    assert.equal(second.isDefault, true);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'b');
  });
});

test('removeAccount: the last remaining account requires confirmRemoval', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => removeAccount('a'), AccountRemovalConfirmationError);
    await removeAccount('a', true);
    const settings = await getSettings();
    assert.equal(settings.defaultAccount, null);
  });
});

test('removeAccount: the current default (not last) requires confirmRemoval and clears the default', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // default
    await configureAccount(appPasswordInput('b'));
    await assert.rejects(() => removeAccount('a'), AccountRemovalConfirmationError);
    await removeAccount('a', true);

    const settings = await getSettings();
    assert.equal(settings.defaultAccount, null);
    const remaining = await resolveAccount('b');
    assert.equal(remaining.alias, 'b');
  });
});

test('removeAccount: a non-default, non-last account does not require confirmRemoval', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a')); // default
    await configureAccount(appPasswordInput('b'));
    await removeAccount('b'); // no confirmRemoval needed
    const settings = await getSettings();
    assert.equal(settings.defaultAccount, 'a');
  });
});

test('removeAccount: unknown alias throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => removeAccount('nope', true), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});

test('configureAccount: displayName/signature are stored when provided at creation', async () => {
  await withIsolatedEnv(async () => {
    const { account } = await configureAccount({
      ...appPasswordInput('a'),
      displayName: 'Kalpesh Gamit',
      signature: '-- Kalpesh',
    });
    assert.equal(account.displayName, 'Kalpesh Gamit');
    assert.equal(account.signature, '-- Kalpesh');
  });
});

test('updateAccountProfile: sets displayName/signature on an existing account without touching credentials', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    const updated = await updateAccountProfile('a', { displayName: 'Kalpesh Gamit', signature: '-- Kalpesh' });
    assert.equal(updated.displayName, 'Kalpesh Gamit');
    assert.equal(updated.signature, '-- Kalpesh');

    const resolved = await resolveAccount('a');
    assert.equal(resolved.credentials.ciphertext, updated.credentials.ciphertext);
  });
});

test('updateAccountProfile: omitted fields are left unchanged, null clears them', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount({ ...appPasswordInput('a'), displayName: 'Kalpesh Gamit', signature: '-- Kalpesh' });

    const afterPartialUpdate = await updateAccountProfile('a', { signature: '-- New sig' });
    assert.equal(afterPartialUpdate.displayName, 'Kalpesh Gamit');
    assert.equal(afterPartialUpdate.signature, '-- New sig');

    const afterClear = await updateAccountProfile('a', { displayName: null });
    assert.equal(afterClear.displayName, undefined);
    assert.equal(afterClear.signature, '-- New sig');
  });
});

test('updateAccountProfile: unknown alias throws ACCOUNT_NOT_FOUND', async () => {
  await withIsolatedEnv(async () => {
    await configureAccount(appPasswordInput('a'));
    await assert.rejects(() => updateAccountProfile('nope', { displayName: 'X' }), (err: unknown) => {
      assert.ok(err instanceof AccountResolutionError);
      assert.equal(err.code, 'ACCOUNT_NOT_FOUND');
      return true;
    });
  });
});
